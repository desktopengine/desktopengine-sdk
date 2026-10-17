# System Status

`DesktopEngine.systemStatus` tells how the Mac is doing: how busy the processor is, memory, network traffic, power and the battery, how hot it runs and the startup disk, e.g. for a widget that shows them. It needs the [`system-info` permission](/reference/manifest#permissions) in the manifest and `"apiVersion": 8`:

```json
"apiVersion": 8,
"permissions": ["system-info"]
```

```js
const status = DesktopEngine.systemStatus; // null without the permission

if (status) {
  status.onchange = () => draw(status.cpu.usage, status.memory.used / status.memory.total);
  status.onthermalchange = () => warn(status.thermal);
}
```

It never tells which apps run, which network the Mac is on, or any address.

## What it gives

| Property | |
| --- | --- |
| `cpu` | `usage` of the whole processor over the last reading, 0...1, and `cores`: every logical core's `usage` and whether it's an `efficiency` core (Apple silicon; false on Intel Macs), efficiency cores first |
| `memory` | In bytes, as Activity Monitor's Memory tab shows them: `total`, `used` (`app` + `wired` + `compressed`), `app`, `wired`, `compressed`, `cached` (memory macOS gives back when something needs it), `swapUsed`; `pressure` (`normal`, `warning`, `critical`, as the Memory Pressure graph) and `swapping` (memory was written out to the disk in the last 10 seconds) |
| `network` | `online`, how it connects (`interface`: `wifi`, `ethernet`, `cellular`, `other`; null while offline), `expensive` (e.g. a phone's Personal Hotspot), bytes per second `receivedPerSecond` / `sentPerSecond` over the last reading, and bytes `received` / `sent` as the network interfaces count them (each from when it came up, usually when the Mac started) |
| `power` | `source` (`battery` or `ac`), `battery` (null on Macs without one), `adapterWatts` (what the power adapter can give; null on battery and when the Mac doesn't know), `systemWatts` (what the whole Mac draws now; null when the Mac doesn't tell), `lowPowerMode` |
| `power.battery` | `level` 0...1, `charging`, `full` (plugged in and not charging: full, or macOS holds it below full to keep it healthy), `timeToEmpty` and `timeToFull` in minutes |
| `thermal` | How hard the Mac works to stay cool, as macOS reports it: `nominal`, `fair`, `serious`, `critical` (macOS slows the Mac down to cool it). Not a temperature: a Mac can run hot and still be `nominal` |
| `temperature` | The processor's temperature in °C, the average of its cores' sensors; null when the Mac doesn't let the app read it |
| `disk` | The startup disk's `total` (to a gigabyte, 10⁹ bytes) and what's `available` for new files, as Finder shows it, in bytes |
| `bootTime` | When the Mac started, ms since the epoch (like `Date.now()`), to the minute |

- `timeToEmpty` is null while plugged in, and for a minute or two after unplugging while macOS still estimates; `timeToFull` is null unless it's charging, and while macOS estimates.
- `systemWatts` changes as often as the Mac tells: on some Macs with every reading, on others about once a minute. Right after the Mac is plugged in or unplugged it may be null for a while, until the Mac reports for the new source. Some Macs never tell: show something else then.
- `temperature` moves with the work the Mac does: under a heavy load it reads well above idle long before `thermal` changes. Treat it as something to show; warn with `thermal`. When it's null, show `thermal` instead.
- `received` and `sent` leave out the Mac talking to itself (loopback); a VPN's traffic counts on both the VPN and the connection it goes over.

## Readings

The app takes a reading about once a second while your content listens to `change`, `powerchange`, `thermalchange`, `networkchange` or `memorypressurechange`, or read a property in the last 2 seconds, and stops otherwise: one sampler serves all content, so it costs little, but remove listeners you don't need.

- Each property (`cpu`, `memory`, `network`, `power`, `disk`) is a frozen object, `cores` and `battery` too. The next reading replaces them with new objects, and until then a read gives the same objects: keep a reference to compare with the next one.
- While you listen to one of those events, the properties change only along with `change`: reads between two `change`s give the reading the last one told about. Without a listener, a read gives the latest reading, the same one until your code returns.
- A reading's usage and rates are measured since the reading before. The first one, and the first after readings stopped for a while, are measured over a moment before them (a read with no reading coming waits that moment, a fraction of a second: if you read less often than every 2 seconds, listen to `change` instead of reading on a timer).

## Events

`change` comes with every reading. The others come right after it, in this order, when the reading differs from the previous one your content got (the last `change`'s, or what you read before you started listening):

| Event | When |
| --- | --- |
| `powerchange` | The Mac was plugged in or unplugged, the battery started or stopped charging or became full, or Low Power Mode turned on or off |
| `thermalchange` | `thermal` changed |
| `networkchange` | The Mac went online or offline, or changed how it connects (also whether the connection is `expensive`) |
| `memorypressurechange` | `memory.pressure` changed |
| `resume` | Your content runs again after it was suspended, see below |

None has a payload but `resume`: read the properties, which already hold the new reading. When macOS tells of one of these changes, the app reads again right away instead of waiting for the next second.

## While the content is suspended

Nothing comes while your content is suspended: when the Mac or its displays sleep, when the user pauses all content (or pauses yours), and in the other cases in [Performance and Pausing](./performance). When it runs again, `resume` comes with how long it was:

```js
status.onresume = ({ suspendedAt, resumedAt, reason }) => {
  // reason: 'sleep' (the Mac slept), 'displaysleep' (its displays slept) or 'paused' (the user or the app paused it)
  log(`Away ${Math.round((resumedAt - suspendedAt) / 60000)} min`);
};
```

- `suspendedAt` and `resumedAt` are ms since the epoch. The reason is `sleep` if the Mac slept at any time meanwhile, else `displaysleep` if its displays did, else `paused`.
- `resume` comes whether or not you listen to the other events; listening only to `resume` doesn't keep readings coming.
- After `resume`, the next reading comes with `change`, and the other events for whatever changed while it was suspended (e.g. `powerchange` when the Mac was unplugged meanwhile).

## Without the permission

Without the permission (not declared, or the user denied it) `DesktopEngine.systemStatus` is `null`, and in apps with an API older than 8 it's `undefined`. `new DesktopEngineRuntime.SystemStatus()` throws then; with the permission there's only one, `DesktopEngine.systemStatus`, and constructing another throws a `TypeError`.

## On the web

The browser can't see the Mac: in the web preview (`desktopengine dev --web` and the store) the readings are made up, with values that move like a Mac's. In `dev --web`, press ⚡ in the menu bar (shown for content with the permission) to try your content in every state: `thermal` states, offline and how it connects, memory pressure and swapping, on battery, plugged in or full, a low battery or none, Low Power Mode, an unknown `systemWatts` or `temperature`, and suspending it for 5 seconds as if the Mac or its displays slept or the content was paused, which ends with `resume`.
