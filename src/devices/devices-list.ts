import { animate } from "@lit-labs/motion";
import { LitElement, html, css, nothing } from "lit";
import { customElement, property, query, state } from "lit/decorators.js";
import { repeat } from "lit/directives/repeat.js";
import {
  subscribeDevices,
  ImportableDevice,
  ConfiguredDevice,
} from "../api/devices";
import { openWizardDialog } from "../wizard";
import "@material/mwc-button";
import "@material/mwc-textfield";
import "@material/mwc-icon-button";
import "@material/mwc-menu";
import "@material/mwc-list/mwc-list-item";
import { subscribeOnlineStatus } from "../api/online-status";
import "./configured-device-card";
import "./importable-device-card";
import "../components/esphome-search";
import { MetadataRefresher } from "./device-metadata-refresher";
import { ESPHomeSearch } from "../components/esphome-search";
import { fireEvent } from "../util/fire-event";

// Enhanced search component
import "../../esphome-webui-components/src/search-input.js";

// Enhanced UI Components - import directly from submodule
import "../../esphome-webui-components/src/esphome-data-table.js";
import "../../esphome-webui-components/src/esphome-status-indicator.js"; 
import "../../esphome-webui-components/src/esphome-button.js";
import "../../esphome-webui-components/src/esphome-action-menu.js";

// Type definitions for enhanced components
interface DataTableColumn {
  key: string;
  title: string;
  label?: string;
  sortable?: boolean;
  filterable?: boolean;
  groupable?: boolean;
  hidden?: boolean;
  width?: string;
  minWidth?: string;
  maxWidth?: string;
  flex?: number;
  align?: "left" | "center" | "right";
  type?: "numeric" | "icon" | "icon-button" | "overflow-menu";
  template?: (value: any, row: any) => any;
  extraTemplate?: (value: any, row: any) => any;
}

interface DataTableRow {
  [key: string]: any;
}

interface MenuItem {
  label: string;
  action: string;
  icon?: string;
  divider?: boolean;
  destructive?: boolean;
}

@customElement("esphome-devices-list")
class ESPHomeDevicesList extends LitElement {
  @property() public showDiscoveredDevices = false;

  @state() private _devices?: Array<ImportableDevice | ConfiguredDevice>;
  @state() private _onlineStatus: Record<string, boolean> = {};
  @state() private _viewMode: "list" | "grid" = "list";
  @state() private _sortBy: string = "name";
  @state() private _sortDirection: "asc" | "desc" = "asc";
  @state() private _groupBy: string = "";
  @state() private _collapsedGroups: string[] = [];
  @state() private _searchValue = "";
  @state() private _filterMenuOpen = false;
  @state() private _sortMenuOpen = false;
  @state() private _groupMenuOpen = false;

  @query("esphome-search") private _search!: ESPHomeSearch;

  private _devicesUnsub?: ReturnType<typeof subscribeDevices>;
  private _onlineStatusUnsub?: ReturnType<typeof subscribeOnlineStatus>;
  private _metadataRefresher = new MetadataRefresher();
  private _new = new Set<string>();

  private _isImportable = (item: any): item is ImportableDevice => {
    return "package_import_url" in item;
  };

  protected render() {
    // catch when 1st load there is no data yet, and we don't want to show no devices message
    if (!this._devices) {
      return html``;
    }

    const filtered: Array<ImportableDevice | ConfiguredDevice> =
      this._devices.filter((item) => this._filter(item));
    const discoveredCount = this._devices.filter(
      (item) => this._isImportable(item) && !item.ignored,
    ).length;

    return html`
      <div class="device-builder-container">
        <!-- Header -->
        <div class="builder-header">
          <div class="header-left">
            <mwc-icon-button icon="home"></mwc-icon-button>
            <h1>ESPHome Device Builder</h1>
          </div>
          <button class="create-device-button" @click=${this._handleOpenWizardClick}>
            <mwc-icon>add</mwc-icon>
            Create device
          </button>
          <mwc-icon-button icon="more_vert"></mwc-icon-button>
        </div>

        <!-- Toolbar -->
        <div class="toolbar">
          <div class="toolbar-left">
            <!-- Filters button -->
            <button class="toolbar-button" @click=${() => this._filterMenuOpen = !this._filterMenuOpen}>
              <mwc-icon>filter_alt</mwc-icon>
              Filters
              <mwc-icon>arrow_drop_down</mwc-icon>
            </button>

            <!-- Search -->
            <search-input
              .value=${this._searchValue}
              placeholder="Search ESPHome devices"
              @value-changed=${(e: CustomEvent) => {
                this._searchValue = e.detail.value;
                this.requestUpdate();
              }}
            ></search-input>
          </div>

          <div class="toolbar-right">
            <!-- Group by -->
            <div class="group-selector">
              <label>Group by:</label>
              <select .value=${this._groupBy} @change=${(e: Event) => this._setGroupBy((e.target as HTMLSelectElement).value)}>
                <option value="" ?selected=${this._groupBy === ""}>None</option>
                <option value="status" ?selected=${this._groupBy === "status"}>Status</option>
                <option value="deviceType" ?selected=${this._groupBy === "deviceType"}>Type</option>
                <option value="name" ?selected=${this._groupBy === "name"}>Name</option>
              </select>
            </div>

            <!-- Sort by -->
            <button class="toolbar-button" @click=${() => this._sortMenuOpen = !this._sortMenuOpen}>
              Sort by Name
              <mwc-icon>arrow_drop_down</mwc-icon>
            </button>

            <!-- View toggle -->
            <div class="view-toggle">
              <button 
                class="view-button ${this._viewMode === 'list' ? 'active' : ''}"
                @click=${() => this._setViewMode('list')}
                title="List view"
              >
                <mwc-icon>view_list</mwc-icon>
              </button>
              <button 
                class="view-button ${this._viewMode === 'grid' ? 'active' : ''}"
                @click=${() => this._setViewMode('grid')}
                title="Grid view"
              >
                <mwc-icon>view_module</mwc-icon>
              </button>
            </div>

            <!-- Settings button -->
            <mwc-icon-button icon="settings"></mwc-icon-button>
          </div>
        </div>

        <!-- Search placeholder div -->
        <div style="display: none;">
          <esphome-search @input=${() => this.requestUpdate()}></esphome-search>
        </div>

        <!-- Content -->
        ${this._devices.length === 0
          ? html`
              <div class="no-result-container">
                <h5>Welcome to ESPHome</h5>
                <p>It looks like you don't yet have any devices.</p>
                <p>
                  <button class="create-device-button" @click=${this._handleOpenWizardClick}>
                    <mwc-icon>add</mwc-icon>
                    New device
                  </button>
                </p>
              </div>
            `
          : this._viewMode === 'list' 
            ? this._renderTableView(filtered)
            : this._renderGridView(filtered)
        }
      </div>
    `;
  }

  private _setViewMode(mode: "list" | "grid") {
    this._viewMode = mode;
    localStorage.setItem("esphome.devices.viewMode", mode);
  }

  private _renderTableView(devices: Array<ImportableDevice | ConfiguredDevice>) {
    if (devices.length === 0) {
      return html`
        <div class="no-result-container">
          <h5>No devices found</h5>
          <p>Adjust your search criteria.</p>
        </div>
      `;
    }

    // Group devices by type (configured vs discovered)
    const configuredDevices = devices.filter(d => !this._isImportable(d));
    const discoveredDevices = devices.filter(d => this._isImportable(d));

    const columns: DataTableColumn[] = [
      {
        key: "icon",
        title: "",
        width: "48px",
        align: "center",
        template: (_, row) => this._renderDeviceIcon(row)
      },
      {
        key: "name",
        title: "Name",
        sortable: true,
        filterable: true,
        groupable: true,
        width: "30%",
        template: (value, row) => html`
          <div class="device-info">
            <div class="device-name">${value}</div>
            ${row.friendly_name && row.friendly_name !== value 
              ? html`<div class="device-subtitle">${row.friendly_name}</div>` 
              : nothing}
          </div>
        `
      },
      {
        key: "status",
        title: "Status", 
        width: "200px",
        sortable: true,
        filterable: true,
        groupable: true,
        template: (_, row) => {
          const status = this._getDeviceStatus(row);
          const hasUpdate = !this._isImportable(row) && (row as ConfiguredDevice).update_available;
          
          return html`
            <div class="status-cell">
              <esphome-status-indicator 
                status=${status}
                show-text
              ></esphome-status-indicator>
              ${hasUpdate 
                ? html`
                    <span class="update-badge">
                      <mwc-icon>circle_notifications</mwc-icon>
                      Update available
                    </span>
                  ` 
                : nothing}
            </div>
          `;
        }
      },
      {
        key: "configuration",
        title: "File name",
        width: "30%",
        sortable: true,
        filterable: true,
        template: (value, row) => {
          if (this._isImportable(row)) {
            return html`<span class="filename">${row.project_name || "—"}</span>`;
          }
          const filename = value ? value.replace(/\.ya?ml$/, ".yaml") : "—";
          return html`<span class="filename">${filename}</span>`;
        }
      },
      {
        key: "actions",
        title: "",
        width: "150px",
        align: "right",
        type: "overflow-menu",
        template: (_, row) => this._renderTableActions(row)
      }
    ];

    // Combine all devices for unified grouping
    const allDevices = [...configuredDevices, ...discoveredDevices].map(device => ({
      ...device,
      deviceType: this._isImportable(device) ? 'discovered' : 'configured'
    }));

    return html`
      <div class="table-layout">
        <esphome-data-table
          .columns=${columns}
          .data=${allDevices}
          .filter=${this._searchValue}
          .groupColumn=${this._groupBy || undefined}
          .initialCollapsedGroups=${this._collapsedGroups}
          clickable
          selectable
          @row-click=${this._handleTableRowClick}
          @sorting-changed=${this._handleTableSort}
          @selection-changed=${this._handleSelectionChanged}
        ></esphome-data-table>
      </div>
    `;
  }

  private _renderGridView(devices: Array<ImportableDevice | ConfiguredDevice>) {
    const htmlClass = "grid";
    const htmlDevices = html`${repeat(
      devices!,
      (device) => device.name,
      (device) => html`
        ${this._isImportable(device)
          ? html`<esphome-importable-device-card
              .device=${device}
              @device-updated=${this._updateDevices}
            ></esphome-importable-device-card>`
          : html`<esphome-configured-device-card
              ${animate({
                id: device.name,
                inId: device.name,
                skipInitial: true,
                disabled: !this._new.has(device.name),
              })}
              data-name=${device.name}
              .device=${device}
              .onlineStatus=${(this._onlineStatus || {})[
                device.configuration
              ]}
              .highlightOnAdd=${this._new.has(device.name)}
              @deleted=${this._updateDevices}
            ></esphome-configured-device-card>`}
      `,
    )}`;

    return html`<div class="${htmlClass}">${htmlDevices}</div>`;
  }

  private _renderDeviceIcon(device: ImportableDevice | ConfiguredDevice) {
    const name = device.name.toLowerCase();
    
    if (name.includes('environmental') || name.includes('sensor')) {
      return html`
        <mwc-icon class="device-icon">device_thermostat</mwc-icon>
      `;
    }
    
    if (name.includes('presence') || name.includes('motion')) {
      return html`
        <mwc-icon class="device-icon">directions_walk</mwc-icon>
      `;
    }
    
    if (name.includes('voice') || name.includes('assistant')) {
      return html`
        <mwc-icon class="device-icon">mic</mwc-icon>
      `;
    }

    if (name.includes('weatherman') || name.includes('weather')) {
      return html`
        <mwc-icon class="device-icon">wb_sunny</mwc-icon>
      `;
    }
    
    // Default device icon
    return html`
      <mwc-icon class="device-icon">memory</mwc-icon>
    `;
  }

  private _getDeviceStatus(device: ImportableDevice | ConfiguredDevice): string {
    if (this._isImportable(device)) {
      return "discovered";
    }
    const configured = device as ConfiguredDevice;
    const isOnline = this._onlineStatus[configured.configuration];
    
    if (configured.update_available) {
      return "update-available";
    }
    
    return isOnline ? "online" : "offline";
  }

  private _renderTableActions(device: ImportableDevice | ConfiguredDevice) {
    if (this._isImportable(device)) {
      const importable = device as ImportableDevice;
      return html`
        <div class="table-actions">
          <button 
            class="action-button primary" 
            @click=${(e: Event) => {
              e.stopPropagation();
              this._handleAdopt(e, importable);
            }}
          >
            Take control
          </button>
        </div>
      `;
    }

    const configured = device as ConfiguredDevice;
    const menuItems: MenuItem[] = [
      { label: "Logs", action: "logs", icon: "description" },
      { label: "Validate", action: "validate", icon: "check_circle" },
      { label: "Edit", action: "edit", icon: "edit" },
      { label: "Rename", action: "rename", icon: "drive_file_rename_outline" },
      { label: "Change device icon", action: "change-icon", icon: "image" },
      { label: "Download file", action: "download", icon: "download" },
      { label: "Delete", action: "delete", icon: "delete", destructive: true, divider: true }
    ];
    
    return html`
      <div class="table-actions">
        <!-- External link icon -->
        <mwc-icon-button 
          icon="open_in_new"
          title="Visit device"
          @click=${(e: Event) => {
            e.stopPropagation();
            this._handleVisit(e, configured);
          }}
        ></mwc-icon-button>
        
        <!-- Edit icon -->
        <mwc-icon-button 
          icon="edit"
          title="Edit"
          @click=${(e: Event) => {
            e.stopPropagation();
            this._handleEdit(e, configured);
          }}
        ></mwc-icon-button>
        
        <!-- Three dots menu -->
        <esphome-action-menu
          .items=${menuItems}
          @action=${(e: CustomEvent) => {
            e.stopPropagation();
            this._handleMenuAction(e, configured);
          }}
        ></esphome-action-menu>
      </div>
    `;
  }

  private _handleTableRowClick(e: CustomEvent) {
    const device = e.detail.id ? 
      this._devices?.find(d => d.name === e.detail.id) : 
      e.detail.row;
    if (device && !this._isImportable(device)) {
      this._handleEdit(e, device as ConfiguredDevice);
    }
  }

  private _handleTableSort(e: CustomEvent) {
    this._sortBy = e.detail.column;
    this._sortDirection = e.detail.direction;
    localStorage.setItem("esphome.devices.sortBy", this._sortBy);
    localStorage.setItem("esphome.devices.sortDirection", this._sortDirection);
  }

  private _handleAdopt(e: Event, device: ImportableDevice) {
    e.stopPropagation();
    fireEvent(this, "adopt-device", { device });
  }

  private _handleEdit(e: Event, device: ConfiguredDevice) {
    e.stopPropagation();
    fireEvent(this, "edit-device", { device });
  }

  private _handleLogs(device: ConfiguredDevice) {
    fireEvent(this, "show-logs", { device });
  }

  private _handleVisit(e: Event, device: ConfiguredDevice) {
    e.stopPropagation();
    if (device.ip) {
      window.open(`http://${device.ip}`, "_blank");
    }
  }

  private _handleMenuAction(e: CustomEvent, device: ConfiguredDevice) {
    const action = e.detail.action;
    switch (action) {
      case "edit":
        this._handleEdit(e, device);
        break;
      case "logs":
        this._handleLogs(device);
        break;
      case "delete":
        fireEvent(this, "delete-device", { device });
        break;
      default:
        fireEvent(this, "device-action", { action, device });
    }
  }

  private _filter(item: ImportableDevice | ConfiguredDevice): boolean {
    if (!this.showDiscoveredDevices && this._isImportable(item)) {
      return false;
    }

    if (this._searchValue) {
      const searchValue = this._searchValue.toLowerCase();
      if (item.name!.toLowerCase().indexOf(searchValue) >= 0) {
        return true;
      }
      if (
        "friendly_name" in item &&
        item.friendly_name &&
        item.friendly_name!.toLowerCase().indexOf(searchValue) >= 0
      ) {
        return true;
      }
      if (
        "comment" in item &&
        item.comment &&
        item.comment!.toLowerCase().indexOf(searchValue) >= 0
      ) {
        return true;
      }
      if (
        "project_name" in item &&
        item.project_name &&
        item.project_name!.toLowerCase().indexOf(searchValue) >= 0
      ) {
        return true;
      }
      return false;
    }
    return true;
  }

  private _handleSelectionChanged(e: CustomEvent) {
    console.log('Selection changed:', e.detail.value);
  }

  private _setGroupBy(groupBy: string) {
    this._groupBy = groupBy;
    localStorage.setItem("esphome.devices.groupBy", groupBy);
  }

  private _handleShowDiscovered() {
    fireEvent(this, "toggle-discovered-devices");
  }

  private _handleOpenWizardClick() {
    openWizardDialog();
  }

  static styles = css`
    :host {
      display: flex;
      flex-direction: column;
      width: 100%;
      height: 100%;
      background: #f8f9fa;
      overflow: hidden;
    }

    .device-builder-container {
      display: flex;
      flex-direction: column;
      height: 100%;
      overflow: hidden;
    }

    /* Header Styles */
    .builder-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 8px 16px;
      background: white;
      border-bottom: 1px solid #e0e0e0;
      height: 56px;
      box-shadow: 0 1px 2px rgba(0,0,0,0.05);
      z-index: 10;
    }

    .header-left {
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .builder-header h1 {
      font-size: 20px;
      font-weight: 400;
      color: #3c4043;
      margin: 0;
    }

    .create-device-button {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 8px 24px;
      background: #1a73e8;
      color: white;
      border: none;
      border-radius: 4px;
      font-size: 14px;
      font-weight: 500;
      cursor: pointer;
      transition: all 0.2s ease;
      margin-left: auto;
      margin-right: 8px;
    }

    .create-device-button:hover {
      background: #1557b0;
      box-shadow: 0 1px 3px rgba(0,0,0,0.2);
    }

    .create-device-button mwc-icon {
      font-size: 18px;
    }

    /* Toolbar Styles */
    .toolbar {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 12px 16px;
      background: white;
      border-bottom: 1px solid #e0e0e0;
      gap: 16px;
      box-shadow: 0 2px 4px rgba(0,0,0,0.05);
      z-index: 9;
    }

    .toolbar-left,
    .toolbar-right {
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .toolbar-button {
      display: flex;
      align-items: center;
      gap: 4px;
      padding: 6px 12px;
      background: white;
      border: 1px solid #dadce0;
      border-radius: 4px;
      font-size: 14px;
      color: #5f6368;
      cursor: pointer;
      transition: all 0.2s ease;
      white-space: nowrap;
    }

    .toolbar-button:hover {
      background: #f8f9fa;
      border-color: #dadce0;
    }

    .toolbar-button mwc-icon {
      font-size: 18px;
    }

    search-input {
      flex: 1;
      max-width: 400px;
    }

    .group-selector {
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .group-selector label {
      font-size: 14px;
      color: #5f6368;
      white-space: nowrap;
    }

    .group-selector select {
      padding: 6px 12px;
      border: 1px solid #dadce0;
      border-radius: 4px;
      background: white;
      font-size: 14px;
      color: #3c4043;
      cursor: pointer;
    }

    .group-selector select:focus {
      outline: none;
      border-color: #1a73e8;
      box-shadow: 0 0 0 1px #1a73e8;
    }

    .view-toggle {
      display: flex;
      background: #e8eaed;
      border-radius: 4px;
      padding: 2px;
    }

    .view-button {
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 6px;
      background: transparent;
      border: none;
      border-radius: 2px;
      cursor: pointer;
      transition: all 0.2s ease;
      color: #5f6368;
    }

    .view-button.active {
      background: white;
      color: #1a73e8;
      box-shadow: 0 1px 2px rgba(0,0,0,0.1);
    }

    .view-button mwc-icon {
      font-size: 18px;
    }

    /* Table Layout Styles */
    .table-layout {
      flex: 1;
      overflow-y: auto;
      overflow-x: hidden;
      padding: 24px;
      min-height: 0; /* Important for Firefox */
    }

    .device-group {
      margin-bottom: 32px;
      background: white;
      border-radius: 8px;
      overflow: hidden;
      box-shadow: 0 1px 2px rgba(0,0,0,0.05);
      max-width: 100%;
    }
    
    /* Ensure table doesn't overflow */
    esphome-data-table {
      display: block;
      width: 100%;
      overflow-x: auto;
    }

    .group-header {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 16px 20px;
      background: #fafafa;
      border-bottom: 1px solid #e0e0e0;
      cursor: pointer;
    }

    .group-header:hover {
      background: #f5f5f5;
    }

    .expand-icon {
      color: #5f6368;
      transition: transform 0.2s ease;
    }

    .group-title {
      font-size: 14px;
      font-weight: 500;
      color: #3c4043;
      margin: 0;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }

    .device-info {
      display: flex;
      flex-direction: column;
      gap: 2px;
    }

    .device-name {
      font-weight: 400;
      color: #3c4043;
      font-size: 14px;
    }

    .device-subtitle {
      font-size: 12px;
      color: #5f6368;
    }

    .device-icon {
      color: #5f6368;
      font-size: 24px;
    }

    .filename {
      font-family: 'Roboto Mono', monospace;
      font-size: 13px;
      color: #5f6368;
    }

    .status-cell {
      display: flex;
      flex-direction: column;
      gap: 4px;
    }

    .update-badge {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      font-size: 12px;
      color: #1a73e8;
      font-weight: 500;
    }

    .update-badge mwc-icon {
      font-size: 14px;
    }

    /* Table Actions */
    .table-actions {
      display: flex;
      gap: 4px;
      align-items: center;
      justify-content: flex-end;
    }

    .action-button {
      background: none;
      border: 1px solid #dadce0;
      padding: 6px 16px;
      border-radius: 4px;
      cursor: pointer;
      color: #1a73e8;
      font-size: 14px;
      font-weight: 500;
      transition: all 0.2s ease;
      white-space: nowrap;
    }

    .action-button:hover {
      background: #f8f9fa;
      border-color: #1a73e8;
    }

    .action-button.primary {
      background: #1a73e8;
      color: white;
      border-color: #1a73e8;
    }

    .action-button.primary:hover {
      background: #1557b0;
    }

    /* Grid view styles */
    .grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(350px, 1fr));
      gap: 24px;
      padding: 24px;
      overflow-y: auto;
      flex: 1;
      min-height: 0;
    }

    /* No results */
    .no-result-container {
      text-align: center;
      margin-top: 60px;
      color: #5f6368;
    }

    .no-result-container h5 {
      font-size: 24px;
      font-weight: 400;
      color: #3c4043;
      margin: 0 0 8px 0;
    }

    .no-result-container p {
      font-size: 14px;
      margin: 0 0 24px 0;
    }

    /* Override some material styles */
    mwc-icon-button {
      --mdc-icon-button-size: 40px;
      --mdc-icon-size: 20px;
    }

    /* Responsive */
    @media only screen and (max-width: 768px) {
      .toolbar {
        flex-wrap: wrap;
        gap: 8px;
      }

      .toolbar-left,
      .toolbar-right {
        width: 100%;
        justify-content: space-between;
      }

      .search-container {
        max-width: none;
      }

      .grid {
        grid-template-columns: 1fr;
        padding: 16px;
      }

      .table-layout {
        padding: 16px;
      }
      
      /* Make table scrollable on mobile */
      .device-group {
        overflow-x: auto;
      }
      
      /* Hide some columns on very small screens */
      @media only screen and (max-width: 480px) {
        .filename {
          display: none;
        }
      }
    }
  `;

  private async _updateDevices() {
    await this._devicesUnsub!.refresh();
  }

  private _scrollToDevice(name: string) {
    const elem = this.renderRoot!.querySelector(
      `esphome-configured-device-card[data-name='${name}']`,
    ) as HTMLElementTagNameMap["esphome-configured-device-card"];
    if (elem) {
      elem.scrollIntoView({ behavior: "smooth" });
    }
  }

  public connectedCallback() {
    super.connectedCallback();
    
    // Load saved preferences
    const savedViewMode = localStorage.getItem("esphome.devices.viewMode") as "list" | "grid";
    if (savedViewMode) {
      this._viewMode = savedViewMode;
    }
    
    const savedSortBy = localStorage.getItem("esphome.devices.sortBy");
    if (savedSortBy) {
      this._sortBy = savedSortBy;
    }
    
    const savedSortDirection = localStorage.getItem("esphome.devices.sortDirection") as "asc" | "desc";
    if (savedSortDirection) {
      this._sortDirection = savedSortDirection;
    }
    
    const savedGroupBy = localStorage.getItem("esphome.devices.groupBy");
    if (savedGroupBy) {
      this._groupBy = savedGroupBy;
    }

    this._devicesUnsub = subscribeDevices(async (devices) => {
      if (!devices) return;
      let newName: string | undefined;

      const newDevices = new Set<string>();
      let newList: Array<ImportableDevice | ConfiguredDevice> = [];

      if (devices.configured) {
        devices.configured.forEach((d) => {
          if (
            this._devices &&
            this._devices.filter((old) => old.name === d.name).length === 0
          ) {
            newDevices.add(d.name);
            newName = d.name;
          }
          newList.push(d);
        });
      }

      newList.sort((a, b) => {
        const a_name = a.friendly_name || a.name;
        const b_name = b.friendly_name || b.name;
        return a_name
          .toLocaleLowerCase()
          .localeCompare(b_name.toLocaleLowerCase());
      });

      if (devices.importable) {
        newList = [
          ...devices.importable.sort((a, b) => {
            // Sort by "ignored" status (ignored items should be at the end)
            if (a.ignored !== b.ignored) {
              return Number(a.ignored) - Number(b.ignored); // false (0) comes before true (1)
            }

            // If "ignored" status is the same, sort by "name"
            return a.name
              .toLocaleLowerCase()
              .localeCompare(b.name.toLocaleLowerCase());
          }),
          ...newList,
        ];
      }

      this._devices = newList;
      this._new = newDevices;

      if (newName) {
        await this.updateComplete;
        this._scrollToDevice(newName);
      }

      // check if any YAML has been copied in and needs to
      // have it's metadata generated
      for (const device of devices.configured) {
        if (device.loaded_integrations?.length === 0) {
          this._metadataRefresher.add(device.configuration);
        }
      }
    });
    this._onlineStatusUnsub = subscribeOnlineStatus((res) => {
      this._onlineStatus = res;
    });
  }

  public disconnectedCallback() {
    super.disconnectedCallback();
    if (this._devicesUnsub) {
      this._devicesUnsub();
    }
    if (this._onlineStatusUnsub) {
      this._onlineStatusUnsub();
    }
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "esphome-devices-list": ESPHomeDevicesList;
  }
}