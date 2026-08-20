# Stawl Player Bridge

The bridge lets the Director choose exactly one open Stawl page to share with the player display. Other Stawl tabs remain private and do not replace the active source.

## Start the app

Open two PowerShell terminals in the project folder.

Terminal 1:

```powershell
npm run bridge
```

Terminal 2:

```powershell
npm run dev
```

Open `http://localhost:5173/`.

## Install the Firefox bridge

1. Open `about:debugging#/runtime/this-firefox` in Firefox.
2. Select **Load Temporary Add-on**.
3. Choose `firefox-bridge/manifest.json` from this project.
4. Open or reload the Stawl montage page.
5. Confirm that the **Player bridge** panel appears.
6. Click **Share this page** on the one encounter the players should see.
7. Click **Stop sharing** before selecting another encounter.

## Apply a player assignment to Stawl

1. On the player page, select a hero.
2. Select a challenge.
3. Click **Apply to Stawl**.
4. The shared Stawl tab receives the command, opens that challenge's existing **Assign** control, selects the hero, and confirms it.
5. Run or refresh the montage in Stawl. The bridge will publish the resulting `/run` response back to the player page.

Assignments are queued only for the explicitly shared tab. Choosing a challenge on the player page does not change Stawl until **Apply to Stawl** is pressed.

The selected tab publishes challenge cards to the local bridge. The player display polls the bridge every two seconds. The bridge stores only the selected source in memory and clears it when the bridge process stops.

## Important limitation

The challenge catalogue is present in the visible Stawl HTML, so the extension can read it without an API endpoint. The extension also watches the `/run` response and forwards the sanitized hero result array from the selected tab. The assignment automation expects Stawl's hero picker to expose a native `<select>` element; if it is a custom picker, the player will report that it could not find the player selector.

No Stawl API key or session cookie is sent to the bridge.
