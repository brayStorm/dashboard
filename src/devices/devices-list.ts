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
  divider?: boolean;
  destructive?: boolean;
}

@customElement("esphome-devices-list")
class ESPHomeDevicesList extends LitElement {
  @property() public showDiscoveredDevices = false;

  @state() private _devices?: Array<ImportableDevice | ConfiguredDevice>;
  @state() private _onlineStatus: Record<string, boolean> = {};
  @state() private _viewMode: "cards" | "table" = "cards";
  @state() private _sortBy: string = "name";
  @state() private _sortDirection: "asc" | "desc" = "asc";

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

    if (this._devices.length === 0) {
      return html`
        <div class="no-result-container">
          <h5>Welcome to ESPHome</h5>
          <p>It looks like you don't yet have any devices.</p>
          <p>
            <mwc-button
              raised
              label="New device"
              icon="add"
              @click=${this._handleOpenWizardClick}
            ></mwc-button>
          </p>
        </div>
      `;
    }

    const filtered: Array<ImportableDevice | ConfiguredDevice> =
      this._devices.filter((item) => this._filter(item));
    const discoveredCount = this._devices.filter(
      (item) => this._isImportable(item) && !item.ignored,
    ).length;

    let htmlClass = "no-result-container";
    let htmlDevices = html`
      <h5>No devices found</h5>
      <p>Adjust your search criteria.</p>
    `;
    if ((filtered?.length ? filtered?.length : 0) > 0) {
      htmlClass = "grid";
      htmlDevices = html`${repeat(
        filtered!,
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
    }

    return html`
      <div class="header-controls">
        <esphome-search @input=${() => this.requestUpdate()}></esphome-search>
        <div class="view-controls">
          <mwc-button
            label="Cards"
            ?outlined=${this._viewMode !== "cards"}
            ?raised=${this._viewMode === "cards"}
            @click=${() => this._setViewMode("cards")}
          ></mwc-button>
          <mwc-button
            label="Table"
            ?outlined=${this._viewMode !== "table"}
            ?raised=${this._viewMode === "table"}
            @click=${() => this._setViewMode("table")}
          ></mwc-button>
        </div>
      </div>
      ${!this.showDiscoveredDevices && discoveredCount > 0
        ? html`
            <div class="show-discovered-bar">
              <span>
                Discovered ${discoveredCount}
                device${discoveredCount == 1 ? "" : "s"}
              </span>
              <mwc-button
                label="Show"
                @click=${this._handleShowDiscovered}
              ></mwc-button>
            </div>
          `
        : nothing}
      ${this._viewMode === "table" 
        ? this._renderTableView(filtered)
        : html`<div class="${htmlClass}">${htmlDevices}</div>`}
    `;
  }

  private _setViewMode(mode: "cards" | "table") {
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
        template: (value, row) => html`
          <div class="device-info">
            <div class="device-name">${value}</div>
            ${row.friendly_name ? html`<div class="device-subtitle">${row.friendly_name}</div>` : nothing}
          </div>
        `
      },
      {
        key: "status",
        title: "Status", 
        width: "160px",
        sortable: true,
        template: (_, row) => html`
          <esphome-status-indicator 
            status=${this._getDeviceStatus(row)}
            show-text
          ></esphome-status-indicator>
        `
      },
      {
        key: "configuration",
        title: "File name",
        width: "200px",
        template: (value, row) => this._isImportable(row) 
          ? row.project_name || "—"
          : (value ? value.replace(/\.ya?ml$/, "") : "—")
      },
      {
        key: "actions",
        title: "",
        width: "120px",
        align: "right",
        template: (_, row) => this._renderTableActions(row)
      }
    ];

    return html`
      <div class="table-layout">
        ${configuredDevices.length > 0 ? html`
          <div class="device-group">
            <div class="group-header">
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

  private _renderDeviceIcon(device: ImportableDevice | ConfiguredDevice) {
    // Device type icons based on name patterns
    const name = device.name.toLowerCase();
    
    if (name.includes('environmental') || name.includes('sensor')) {
      return html`
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
          <rect x="4" y="4" width="16" height="16" rx="2" stroke="#5f6368" stroke-width="2" fill="none"/>
          <circle cx="12" cy="12" r="3" stroke="#5f6368" stroke-width="2" fill="none"/>
        </svg>
      `;
    }
    
    if (name.includes('presence') || name.includes('motion')) {
      return html`
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
          <path d="M12 2C13.1 2 14 2.9 14 4C14 5.1 13.1 6 12 6C10.9 6 10 5.1 10 4C10 2.9 10.9 2 12 2ZM21 9V7L15 13.5V22H13V15.5L11 14L9 16V22H7V14L12 8L21 9Z" fill="#5f6368"/>
        </svg>
      `;
    }
    
    if (name.includes('voice') || name.includes('assistant')) {
      return html`
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
          <path d="M12 1c-4.97 0-9 4.03-9 9v7c0 1.66 1.34 3 3 3h3v-8H5v-2c0-3.87 3.13-7 7-7s7 3.13 7 7v2h-4v8h4v1h-7v2h6c1.66 0 3-1.34 3-3V10c0-4.97-4.03-9-9-9z" fill="#5f6368"/>
        </svg>
      `;
    }
    
    // Default device icon
    return html`
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
        <rect x="2" y="4" width="20" height="16" rx="2" stroke="#5f6368" stroke-width="2" fill="none"/>
        <circle cx="12" cy="12" r="2" fill="#5f6368"/>
      </svg>
    `;
  }

  private _getDeviceStatus(device: ImportableDevice | ConfiguredDevice): string {
    if (this._isImportable(device)) {
      return "discovered";
    }
    const configured = device as ConfiguredDevice;
    const isOnline = this._onlineStatus[configured.configuration];
    return isOnline ? "online" : "offline";
  }

  private _renderTableActions(device: ImportableDevice | ConfiguredDevice) {
    if (this._isImportable(device)) {
      const importable = device as ImportableDevice;
      return html`
        <div class="table-actions">
          <button class="action-button primary" @click=${() => this._handleAdopt(importable)}>
            Take control
          </button>
        </div>
      `;
    }

    const configured = device as ConfiguredDevice;
    
    return html`
      <div class="table-actions">
        <!-- External link icon -->
        <button 
          class="icon-button"
          title="Visit device"
          @click=${() => this._handleVisit(configured)}
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
            <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
            <polyline points="15,3 21,3 21,9" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
            <line x1="10" y1="14" x2="21" y2="3" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
        </button>
        
        <!-- Edit icon -->
        <button 
          class="icon-button"
          title="Edit"
          @click=${() => this._handleEdit(configured)}
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
            <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
        </button>
        
        <!-- Three dots menu -->
        <button 
          class="icon-button"
          title="More actions"
          @click=${(e: Event) => this._handleMenuToggle(e, configured)}
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
            <circle cx="12" cy="12" r="1" fill="currentColor"/>
            <circle cx="19" cy="12" r="1" fill="currentColor"/>
            <circle cx="5" cy="12" r="1" fill="currentColor"/>
          </svg>
        </button>
      </div>
    `;
  }

  private _handleTableRowClick(e: CustomEvent) {
    const device = e.detail.row;
    if (!this._isImportable(device)) {
      this._handleEdit(device as ConfiguredDevice);
    }
  }

  private _handleTableSort(e: CustomEvent) {
    this._sortBy = e.detail.column;
    this._sortDirection = e.detail.direction;
    localStorage.setItem("esphome.devices.sortBy", this._sortBy);
    localStorage.setItem("esphome.devices.sortDirection", this._sortDirection);
  }

  private _handleAdopt(device: ImportableDevice) {
    // Existing adopt logic
    fireEvent(this, "adopt-device", { device });
  }

  private _handleEdit(device: ConfiguredDevice) {
    // Existing edit logic
    fireEvent(this, "edit-device", { device });
  }

  private _handleLogs(device: ConfiguredDevice) {
    // Existing logs logic
    fireEvent(this, "show-logs", { device });
  }

  private _handleVisit(device: ConfiguredDevice) {
    if (device.ip) {
      window.open(`http://${device.ip}`, "_blank");
    }
  }

  private _handleMenuToggle(e: Event, device: ConfiguredDevice) {
    e.stopPropagation();
    // Create a simple context menu or dropdown
    const menuItems: MenuItem[] = [
      { label: "View logs", action: "logs" },
      { label: "Clean build files", action: "clean" },
      { label: "Delete", action: "delete", destructive: true, divider: true }
    ];
    
    fireEvent(this, "show-device-menu", { device, items: menuItems, event: e });
  }

  private _handleMenuAction(e: CustomEvent, device: ConfiguredDevice) {
    const action = e.detail.action;
    switch (action) {
      case "edit":
        this._handleEdit(device);
        break;
      case "logs":
        this._handleLogs(device);
        break;
      case "visit":
        if (device.ip) {
          window.open(`http://${device.ip}`, "_blank");
        }
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
    .grid {
      display: grid;
      grid-template-columns: 1fr;
      grid-template-columns: 1fr 1fr 1fr;
      grid-column-gap: 1.5rem;
      margin: 20px auto;
      width: 90%;
      max-width: 1920px;
      justify-content: stretch;
    }
    @media only screen and (max-width: 1100px) {
      .grid {
        grid-template-columns: 1fr 1fr;
        grid-column-gap: 1.5rem;
      }
    }
    @media only screen and (max-width: 750px) {
      .grid {
        grid-template-columns: 1fr;
        grid-column-gap: 0;
      }
      .container {
        width: 100%;
      }
    }
    esphome-configured-device-card,
    esphome-importable-device-card {
      margin: 0.5rem 0 1rem 0;
    }
    .no-result-container {
      text-align: center;
      margin-top: 40px;
      color: var(--primary-text-color);
    }
    h5 {
      font-size: 1.64rem;
      line-height: 110%;
      font-weight: 400;
      margin: 1rem 0 0.65rem 0;
    }
    hr {
      margin-top: 16px;
      margin-bottom: 16px;
    }
    .show-discovered-bar {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 8px 8px 8px 16px;
      background-color: var(--primary-footer-bg-color);
      border-top: 1px solid var(--divider-color);
      color: var(--mdc-theme-on-primary);
    }
    
    .header-controls {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 16px;
      gap: 16px;
    }
    
    .view-controls {
      display: flex;
      gap: 8px;
    }
    
    .table-container {
      margin: 20px auto;
      width: 95%;
      max-width: 1920px;
    }
    
    .device-name strong {
      color: var(--primary-text-color);
    }
    
    .device-name small {
      color: var(--secondary-text-color);
      font-size: 0.9em;
    }
    
    .status-cell {
      display: flex;
      align-items: center;
      gap: 8px;
    }
    
    .table-actions {
      display: flex;
      gap: 8px;
      align-items: center;
      justify-content: flex-end;
    }
    
    .icon-button {
      background: none;
      border: none;
      padding: 8px;
      border-radius: 4px;
      cursor: pointer;
      color: #5f6368;
      transition: all 0.2s ease;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    
    .icon-button:hover {
      background: #f1f3f4;
      color: #1a73e8;
    }
    
    .action-button {
      background: none;
      border: 1px solid #dadce0;
      padding: 8px 16px;
      border-radius: 4px;
      cursor: pointer;
      color: #1a73e8;
      font-size: 14px;
      font-weight: 500;
      transition: all 0.2s ease;
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
    
    .table-layout {
      margin: 20px 0;
    }
    
    .device-group {
      margin-bottom: 32px;
    }
    
    .group-header {
      margin-bottom: 16px;
    }
    
    .group-title {
      font-size: 16px;
      font-weight: 500;
      color: #3c4043;
      margin: 0;
      display: flex;
      align-items: center;
      gap: 8px;
    }
    
    .device-info {
      display: flex;
      flex-direction: column;
      gap: 2px;
    }
    
    .device-name {
      font-weight: 500;
      color: #3c4043;
    }
    
    .device-subtitle {
      font-size: 12px;
      color: #5f6368;
    }
    
    @media only screen and (max-width: 768px) {
      .header-controls {
        flex-direction: column;
        align-items: stretch;
        gap: 12px;
      }
      
      .view-controls {
        justify-content: center;
      }
      
      .table-container {
        width: 100%;
        margin: 10px 0;
      }
      
      .table-actions {
        flex-direction: column;
        gap: 4px;
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
    const savedViewMode = localStorage.getItem("esphome.devices.viewMode") as "cards" | "table";
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
