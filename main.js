"use strict";

const { app, shell, BrowserWindow, Menu, dialog, ipcMain } = require("electron");
const { autoUpdater } = require("electron-updater");
const path = require("path");
const url = require("url");
const os = require("os");
const uuid = require("uuid/v4");
const { debug, test } = require("yargs").argv;
const ElectronStore = require("electron-store");

const settings = global.settings = new ElectronStore({
    name: "settings",
    defaults: {
        autoDownloadUpdates: false,
        allowPrerelease: autoUpdater.allowPrerelease,
        windowBounds: {
            width: 900,
            height: 600
        },
        fullscreen: false
    }
});

if (!settings.get("uuid")) {
    settings.set("uuid", uuid());
}

let win;
let updateOnQuit = false;

if (debug || test) {
    app.setPath("userData", path.join(app.getPath("temp"), app.getName()));
}

function updateReady(updateInfo) {
    dialog.showMessageBox({
        message: "Install Update",
        detail: `Padlock version ${updateInfo.version} has been downloaded. The update will be installed ` +
            `the next time the app is launched.`,
        buttons: ["Install Later", "Install And Restart"],
        defaultId: 1,
    }, (buttonIndex) => {
        if (buttonIndex === 1) {
            autoUpdater.quitAndInstall();
        } else {
            updateOnQuit = true;
        }
    });
}

autoUpdater.on("update-downloaded", updateReady);

function htmlToText(html) {
    return html
        .replace(/<p>([\w\W]*?)<\/p>/g, "$1")
        .replace(/<\/?ul>/g, "")
        .replace(/<li>([\w\W]*?)<\/li>/g, "\u2022 $1");
}

function updateAvailable(versionInfo) {
    if (autoUpdater.autoDownload) {
        return;
    }

    dialog.showMessageBox({
        type: "info",
        message: `A new version of Padlock is available! (v${versionInfo.version})`,
        detail: htmlToText(versionInfo.releaseNotes),
        checkboxLabel: "Automatically download and install updates in the future (recommended)",
        buttons: ["Remind Me Later", "Download And Install"],
        defaultId: 1,
    }, (buttonIndex, checkboxChecked) => {
        settings.set("autoDownloadUpdates", checkboxChecked);

        if (buttonIndex === 1) {
            autoUpdater.downloadUpdate();

            dialog.showMessageBox({
                message: "Downloading Update...",
                detail: "The new version is being downloaded. You'll be notified when it is ready to be installed!"
            });
        }
    });
}

function checkForUpdates(manual) {
    autoUpdater.autoDownload = settings.get("autoDownloadUpdates");
    autoUpdater.allowPrerelease = settings.get("allowPrerelease");

    const check = autoUpdater.checkForUpdates();
    check && check.then((result) => {
        if (result.fileInfo) {
            updateAvailable(result.versionInfo);
        } else if (manual) {
            dialog.showMessageBox({
                type: "info",
                message: "No Updates Available",
                detail: "Your version of Padlock is up to date.",
                checkboxLabel: "Automatically download and install updates in the future (recommended)",
                checkboxChecked: settings.get("autoDownloadUpdates")
            }, (buttonIndex, checkboxChecked) => {
                settings.set("autoDownloadUpdates", checkboxChecked);
            });
        }
    });
}

function createWindow() {
    // Create the browser window.
    win = new BrowserWindow({
        width: settings.get("windowBounds.width"),
        height: settings.get("windowBounds.height"),
        x: settings.get("windowBounds.x"),
        y: settings.get("windowBounds.y"),
        fullscreen: settings.get("fullscreen"),
        backgroundColor: "#59c6ff",
        fullscreenable: true
    });

    // and load the index.html of the app.
    win.loadURL(url.format({
        pathname: path.resolve(__dirname, test ? "test/index.html" : "app/index.html"),
        protocol: "file:",
        slashes: true
    }));

    if (debug) {
        // Open the DevTools.
        win.webContents.openDevTools();
    }

    win.on("close", () => {
        settings.set("windowBounds", win.getBounds());
        settings.set("fullscreen", win.isFullScreen());
    });

    win.on("closed", () => {
        win = null;
    });

    // Open links in browser
    win.webContents.on("new-window", function(e, url) {
        e.preventDefault();
        shell.openExternal(url);
    });

}

function createApplicationMenu() {
    const checkForUpdatesItem = {
        label: "Check for Updates...",
        click() { checkForUpdates(true); }
    };

    const appSubMenu = os.platform() === "darwin" ? [ { role: "about" } ] :
        [ { label: `Padlock v${app.getVersion()}`, enabled: false} ];

    appSubMenu.push(
        checkForUpdatesItem,
        { type: "separator" },
        { role: "quit" }
    );

    // Set up menu
    const template = [
        {
            label: "Application",
            submenu: appSubMenu
        },
        {
            label: "Settings",
            submenu: [
                {
                    label: "Updates",
                    submenu: [
                        checkForUpdatesItem,
                        { type: "separator" },
                        {
                            type: "checkbox",
                            label: "Automatically Download and Install Updates",
                            checked: settings.get("autoDownloadUpdates"),
                            click(item) { settings.set("autoDownloadUpdates", item.checked); }
                        },
                        { type: "separator" },
                        {
                            type: "radio",
                            label: "Only Download Stable Releases (recommended)",
                            checked: !settings.get("allowPrerelease"),
                            click(item) { settings.set("allowPrerelease", !item.checked); }
                        },
                        {
                            type: "radio",
                            label: "Download Stable and Beta Releases",
                            checked: settings.get("allowPrerelease"),
                            click(item) { settings.set("allowPrerelease", item.checked); }
                        }
                    ]
                }
            ]
        },
        {
            label: "Edit",
            submenu: [
                { role: "undo" },
                { role: "redo" },
                { type: "separator" },
                { role: "cut" },
                { role: "copy" },
                { role: "paste" },
                { role: "selectall" }
            ]
        }
    ];

    Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.on("ready", () => {
    createWindow();
    createApplicationMenu();

    app.setAsDefaultProtocolClient("padlock");

    checkForUpdates();
});

// Quit when all windows are closed.
app.on("window-all-closed", () => {
    app.quit();
});

app.on("activate", () => {
    if (win === null) {
        createWindow();
    }
});

app.on("before-quit", (e) => {
    if (updateOnQuit) {
        updateOnQuit = false;
        e.preventDefault();
        autoUpdater.quitAndInstall();
    }
});

ipcMain.on("check-updates", () => checkForUpdates(true));
