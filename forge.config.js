const { FusesPlugin } = require("@electron-forge/plugin-fuses");
const { FuseV1Options, FuseVersion } = require("@electron/fuses");

module.exports = {
  out: "dist-forge",
  packagerConfig: {
    asar: true,
    // Explicitly set ignore to override .gitignore and ensure 'dist-electron' is included
    ignore: [
      /^\/src/,
      /^\/.git/,
      /^\/.vscode/,
      /^\/electron\.vite\.config/,
      /^\/tsconfig/,
      /^\/.eslintrc/,
      /^\/.prettier/
    ]
  },
  rebuildConfig: {},
  makers: [
    {
      name: "@electron-forge/maker-squirrel",
      config: {
        name: "system_log_viewer"
      }
    },
    {
      name: "@electron-forge/maker-zip",
      platforms: ["darwin"]
    },
    {
      name: "@electron-forge/maker-deb",
      config: {
        name: "system_log_viewer"
      }
    },
    {
      name: "@electron-forge/maker-rpm",
      config: {
        name: "system_log_viewer"
      }
    }
  ],
  plugins: [
    {
      name: "@electron-forge/plugin-auto-unpack-natives",
      config: {
        name: "system_log_viewer"
      }
    },
    // Fuses are used to enable/disable various Electron functionality
    // at package time, before code signing the application
    new FusesPlugin({
      version: FuseVersion.V1,
      [FuseV1Options.RunAsNode]: false,
      [FuseV1Options.EnableCookieEncryption]: true,
      [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
      [FuseV1Options.EnableNodeCliInspectArguments]: false,
      [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
      [FuseV1Options.OnlyLoadAppFromAsar]: true
    })
  ],
  publishers: [
    {
      name: '@electron-forge/publisher-github',
      config: {
        repository: {
          owner: 'KimKeepLearning',
          name: 'system-log-viewer'
        },
        prerelease: true
      }
    }
  ]
};
