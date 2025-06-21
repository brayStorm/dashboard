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

// Enhanced UI Components - import directly from submodule
import "../../esphome-webui-components/src/esphome-data-table.js";
import "../../esphome-webui-components/src/esphome-status-indicator.js"; 
import "../../esphome-webui-components/src/esphome-button.js";
import "../../esphome-webui-components/src/esphome-action-menu.js";

// Type definitions for enhanced components
interface DataTableColumn {
  key: string;
  title: string;
  sortable?: boolean;
  width?: string;
  align?: "left" | "center" | "right";
  template?: (value: any, row: any) => any;
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
  @state() private _groupBy: string = "status";
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
            <div class="search-container">
              <mwc-icon>search</mwc-icon>
              <input 
                type="text" 
                placeholder="Search ESPHome devices"
                @input=${(e: InputEvent) => {
                  const target = e.target as HTMLInputElement;
                  if (this._search) {
                    this._search.value = target.value;
                    this.requestUpdate();
                  }
                }}
              />
            </div>
          </div>

          <div class="toolbar-right">
            <!-- Group by -->
            <button class="toolbar-button" @click=${() => this._groupMenuOpen = !this._groupMenuOpen}>
              Group by
              <mwc-icon>arrow_drop_down</mwc-icon>
            </button>

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
        template: (_, row) => this._renderTableActions(row)
      }
    ];

    return html`
      <div class="table-layout">
        ${configuredDevices.length > 0 ? html`
          <div class="device-group">
            <div class="group-header">
              <mwc-icon class="expand-icon">expand_more</mwc-icon>
              <h3 class="group-title">Your devices</h3>
            </div>
            <esphome-data-table
              .columns=${columns}
              .data=${configuredDevices}
              .filter=${this._search?.value || ""}
              @row-click=${this._handleTableRowClick}
              @sorting-changed=${this._handleTableSort}
            ></esphome-data-table>
          </div>
        ` : nothing}
        
        ${discoveredDevices.length > 0 ? html`
          <div class="device-group">
            <div class="group-header">
              <mwc-icon class="expand-icon">expand_more</mwc-icon>
              <h3 class="group-title">Discovered</h3>
            </div>
            <esphome-data-table
              .columns=${columns}
              .data=${discoveredDevices}
              .filter=${this._search?.value || ""}
              @row-click=${this._handleTableRowClick}
              @sorting-changed=${this._handleTableSort}
            ></esphome-data-table>
          </div>
        ` : nothing}
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
          <button class="action-button primary" @click=${(e: Event) => this._handleAdopt(e, importable)}>
            Take control
          </button>
        </div>
      `;
    }

    const configured = device as ConfiguredDevice;
    const menuItems: MenuItem[] = [
      { label: "Logs", action: "logs", icon: "M12 2c-4.97 0-9 4.03-9 9v7c0 1.66 1.34 3 3 3h3v-8H5v-2c0-3.87 3.13-7 7-7s7 3.13 7 7v2h-4v8h4v1h-7v2h6c1.66 0 3-1.34 3-3V10c0-4.97-4.03-9-9-9z" },
      { label: "Validate", action: "validate", icon: "M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z" },
      { label: "Edit", action: "edit", icon: "M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34c-.39-.39-1.02-.39-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z" },
      { label: "Rename", action: "rename", icon: "M18.41 5.8L17.2 4.59c-.78-.78-2.05-.78-2.83 0l-2.68 2.68L3 15.96V20h4.04l8.74-8.74 2.63-2.63c.79-.78.79-2.05 0-2.83zM6.21 18H5v-1.21l8.66-8.66 1.21 1.21L6.21 18zM11 20l4-4h6v4H11z" },
      { label: "Change device icon", action: "change-icon", icon: "M12 2l.01 10.55c-.59-.34-1.27-.55-2-.55C7.79 12 6 13.79 6 16s1.79 4 4.01 4S14 18.21 14 16V4h4V2h-6z" },
      { label: "Download file", action: "download", icon: "M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z" },
      { label: "Delete", action: "delete", icon: "M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z", destructive: true, divider: true }
    ];
    
    return html`
      <div class="table-actions">
        <!-- External link icon -->
        <mwc-icon-button 
          icon="open_in_new"
          title="Visit device"
          @click=${(e: Event) => this._handleVisit(e, configured)}
        ></mwc-icon-button>
        
        <!-- Edit icon -->
        <mwc-icon-button 
          icon="edit"
          title="Edit"
          @click=${(e: Event) => this._handleEdit(e, configured)}
        ></mwc-icon-button>
        
        <!-- Three dots menu -->
        <esphome-action-menu
          .items=${menuItems}
          @action=${(e: CustomEvent) => this._handleMenuAction(e, configured)}
        ></esphome-action-menu>
      </div>
    `;
  }

  private _handleTableRowClick(e: CustomEvent) {
    const device = e.detail.row;
    if (!this._isImportable(device)) {
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

    if (this._search?.value) {
      const searchValue = this._search!.value.toLowerCase();
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

    .search-container {
      display: flex;
      align-items: center;
      gap: 8px;
      flex: 1;
      max-width: 400px;
      padding: 8px 16px;
      background: #f1f3f4;
      border-radius: 4px;
      transition: all 0.2s ease;
    }

    .search-container:focus-within {
      background: white;
      box-shadow: 0 1px 3px rgba(0,0,0,0.12);
    }

    .search-container mwc-icon {
      color: #5f6368;
      font-size: 20px;
    }

    .search-container input {
      flex: 1;
      border: none;
      background: none;
      outline: none;
      font-size: 14px;
      color: #3c4043;
    }

    .search-container input::placeholder {
      color: #5f6368;
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