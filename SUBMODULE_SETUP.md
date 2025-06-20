# ESPHome Dashboard Enhanced Components

This document explains the optional enhanced UI components for ESPHome Dashboard.

## Overview

The ESPHome Dashboard supports optional enhanced UI components through a git submodule (`esphome-webui-components`). This provides:

- Modern data table views with Home Assistant styling
- Enhanced status indicators and action buttons  
- Reusable component library for ESPHome ecosystem
- Clean separation of core dashboard and UI enhancements

## Setup Options

### Clone with Submodules (Recommended)

```bash
# Clone with all submodules
git clone --recursive https://github.com/esphome/dashboard.git
cd dashboard
npm install
npm run build
```

### Manual Submodule Setup

```bash
# Clone dashboard only
git clone https://github.com/esphome/dashboard.git
cd dashboard

# Add submodule
git submodule add https://github.com/esphome/esphome-webui-components.git
git submodule update --init --recursive

# Install dependencies and build
npm install
npm run build
```

### Development Workflow

```bash
# Standard development (enhanced components optional)
npm run develop

# Update submodules to latest
git submodule update --remote

# Development with component changes
cd esphome-webui-components
# Make changes, commit, push
cd ..
git add esphome-webui-components
git commit -m "Update webui components"
```

## Component Library Structure

When the submodule is present, the dashboard gains access to:

```
esphome-webui-components/
├── src/
│   ├── esphome-data-table.ts      # Main data table component
│   ├── esphome-status-indicator.ts # Status dots with text
│   ├── esphome-button.ts          # Consistent button styling
│   ├── esphome-action-menu.ts     # Dropdown action menu
│   └── index.ts                   # Exports
├── package.json
├── tsconfig.json
├── rollup.config.js
└── README.md
```

## TypeScript Configuration

The dashboard's `tsconfig.json` includes paths for the submodule:

```json
{
  "compilerOptions": {
    "paths": {
      "@esphome-webui/*": ["esphome-webui-components/src/*"]
    }
  },
  "include": [
    "src/**/*",
    "esphome-webui-components/src/**/*"
  ]
}
```

## Build Integration

The component library is automatically included in the build process when present. The build scripts will:

1. Check for the submodule directory
2. Install component dependencies if needed
3. Build the component library
4. Include components in the main dashboard build

## Fallback Behavior

If the submodule is not present:
- Dashboard builds and runs normally with standard components
- Enhanced features gracefully degrade to basic implementations
- No breaking changes to existing workflows

## CI/CD Integration

For automated builds, ensure submodules are checked out:

```yaml
# GitHub Actions
- uses: actions/checkout@v3
  with:
    submodules: recursive

# Or manually
- run: git submodule update --init --recursive
```

## Troubleshooting

### Submodule Not Found
```bash
# Initialize if missing
git submodule update --init --recursive
```

### Build Errors
```bash
# Rebuild components
cd esphome-webui-components
npm install
npm run build
cd ..
npm run build
```

### TypeScript Import Errors
```bash
# Verify paths are configured correctly
cat tsconfig.json | grep -A 5 "paths"

# Check submodule is present
ls -la esphome-webui-components/
```

## Backwards Compatibility

This enhancement maintains full backwards compatibility:
- Existing dashboard installations continue to work unchanged
- No migration required for current users
- Enhanced features are purely additive

## Security Considerations

- Submodule repositories are maintained by the ESPHome team
- Component library follows same security standards as main dashboard
- No additional runtime dependencies or third-party code

---

*This setup enables enhanced UI components while maintaining the dashboard's core functionality and backwards compatibility.*