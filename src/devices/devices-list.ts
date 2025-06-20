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

    const columns: DataTableColumn[] = [
      {
        key: "status",
        title: "",
        width: "40px",
        align: "center",
        template: (_, row) => html`
          <esphome-status-indicator 
            status=${this._getDeviceStatus(row)}
          ></esphome-status-indicator>
        `
      },
      {
        key: "name",
        title: "Device Name",
        sortable: true,
        template: (value, row) => html`
          <div class="device-name">
            <strong>${value}</strong>
            ${row.friendly_name ? html`<br><small>${row.friendly_name}</small>` : nothing}
          </div>
        `
      },
      {
        key: "statusText",
        title: "Status",
        width: "120px",
        sortable: true,
        template: (_, row) => html`
          <div class="status-cell">
            <esphome-status-indicator 
              status=${this._getDeviceStatus(row)}
              show-text
            ></esphome-status-indicator>
          </div>
        `
      },
      {
        key: "ip",
        title: "IP Address",
        width: "140px",
        template: (_, row) => row.ip || "—"
      },
      {
        key: "configuration",
        title: "Configuration",
        width: "200px",
        template: (value) => value ? value.replace(/\.ya?ml$/, "") : "—"
      },
      {
        key: "actions",
        title: "Actions",
        width: "200px",
        align: "right",
        template: (_, row) => this._renderTableActions(row)
      }
    ];

    const tableData: DataTableRow[] = devices.map(device => ({
      ...device,
      statusText: this._getDeviceStatus(device),
      ip: this._isImportable(device) ? "—" : (device as ConfiguredDevice).ip
    }));

    return html`
      <div class="table-container">
        <esphome-data-table
          .columns=${columns}
          .data=${tableData}
          .filter=${this._search?.value || ""}
          clickable
          @row-click=${this._handleTableRowClick}
          @sorting-changed=${this._handleTableSort}
        ></esphome-data-table>
      </div>
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
          <esphome-button variant="primary" @click=${() => this._handleAdopt(importable)}>
            Adopt
          </esphome-button>
        </div>
      `;
    }

    const configured = device as ConfiguredDevice;
    const menuItems: MenuItem[] = [
      { label: "Edit", action: "edit" },
      { label: "Logs", action: "logs" },
      { label: "Visit", action: "visit" },
      { label: "Validate", action: "validate" },
      { label: "Install", action: "install" },
      { divider: true },
      { label: "Delete", action: "delete", destructive: true }
    ];

    return html`
      <div class="table-actions">
        <esphome-button variant="secondary" @click=${() => this._handleEdit(configured)}>
          Edit
        </esphome-button>
        <esphome-button variant="secondary" @click=${() => this._handleLogs(configured)}>
          Logs
        </esphome-button>
        <esphome-action-menu
          .items=${menuItems}
          @menu-action=${(e: CustomEvent) => this._handleMenuAction(e, configured)}
        ></esphome-action-menu>
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
