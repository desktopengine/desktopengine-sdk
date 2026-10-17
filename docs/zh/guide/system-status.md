# 系统状态

`DesktopEngine.systemStatus` 告诉你这台 Mac 的状况：处理器有多忙、内存、网络流量、电源和电池、温度和启动磁盘，例如给显示这些的小组件用。需要在清单里声明 [`system-info` 权限](/zh/reference/manifest#权限-permissions)，并且 `"apiVersion": 8`：

```json
"apiVersion": 8,
"permissions": ["system-info"]
```

```js
const status = DesktopEngine.systemStatus; // 没有权限时为 null

if (status) {
  status.onchange = () => draw(status.cpu.usage, status.memory.used / status.memory.total);
  status.onthermalchange = () => warn(status.thermal);
}
```

它从不告诉你在运行哪些应用、Mac 连着哪个网络，也不给任何地址。

## 提供什么

| 属性 | |
| --- | --- |
| `cpu` | 整个处理器在上一次读数期间的 `usage`（0...1），以及 `cores`：每个逻辑核心的 `usage` 和它是不是能效核心 `efficiency`（Apple 芯片；Intel Mac 上为 false），能效核心在前 |
| `memory` | 单位是字节，和“活动监视器”的“内存”页一致：`total`、`used`（`app` + `wired` + `compressed`）、`app`、`wired`、`compressed`、`cached`（有需要时 macOS 会让出来的内存）、`swapUsed`；`pressure`（`normal`、`warning`、`critical`，即“内存压力”图）和 `swapping`（最近 10 秒内把内存写到了磁盘上） |
| `network` | `online`、怎么连接（`interface`：`wifi`、`ethernet`、`cellular`、`other`；离线时为 null）、`expensive`（例如手机的个人热点）、上一次读数期间每秒收发的字节数 `receivedPerSecond` / `sentPerSecond`，以及网络接口计下的收发字节数 `received` / `sent`（每个接口从它启用时算起，通常就是 Mac 启动时）|
| `power` | `source`（`battery` 或 `ac`）、`battery`（没有电池的 Mac 上为 null）、`adapterWatts`（电源适配器能提供的功率；用电池时和 Mac 不知道时为 null）、`systemWatts`（整台 Mac 现在的功耗；Mac 不告诉时为 null）、`lowPowerMode` |
| `power.battery` | `level`（0...1）、`charging`、`full`（接着电源且没在充电：充满了，或 macOS 为保护电池让它停在未满）、`timeToEmpty` 和 `timeToFull`（分钟） |
| `thermal` | 按 macOS 的说法，Mac 为了降温有多吃力：`nominal`、`fair`、`serious`、`critical`（macOS 会让 Mac 降速来降温）。它不是温度：Mac 很烫时也可能是 `nominal` |
| `temperature` | 处理器的温度（°C），各核心传感器的平均值；Mac 不让应用读取时为 null |
| `disk` | 启动磁盘的容量 `total`（精确到 GB，即 10⁹ 字节）和可用于新文件的空间 `available`（和“访达”显示的一致），单位是字节 |
| `bootTime` | Mac 启动的时间，自纪元起的毫秒数（和 `Date.now()` 一样），精确到分钟 |

- `timeToEmpty` 在接着电源时为 null，拔掉电源后 macOS 还在估算的一两分钟里也为 null；`timeToFull` 只在充电时有值，macOS 估算时也为 null。
- `systemWatts` 的更新频率取决于 Mac：有的每次读数都变，有的大约一分钟一次。刚插上或拔掉电源后可能有一阵为 null，直到 Mac 按新的电源报告。有些 Mac 从不提供：这时显示别的内容。
- `temperature` 随 Mac 的负载变化：负载重时，早在 `thermal` 变化之前它就会明显高于空闲时。把它当作要显示的数值，提醒用 `thermal`。为 null 时改为显示 `thermal`。
- `received` 和 `sent` 不含 Mac 和自己的通信（回环）；VPN 的流量在 VPN 和它所经过的连接上各算一次。

## 读数

内容监听 `change`、`powerchange`、`thermalchange`、`networkchange` 或 `memorypressurechange`，或者最近 2 秒内读过属性时，应用大约每秒读一次，否则就停下。所有内容共用一个采样器，开销很小，但不需要的监听器还是要移除。

- 每个属性（`cpu`、`memory`、`network`、`power`、`disk`）都是冻结的对象，`cores` 和 `battery` 也是。下一次读数会换成新的对象，在那之前读到的都是同一个对象：留着引用，就能和下一次比较。
- 监听上面这些事件时，属性只随 `change` 一起变：两次 `change` 之间读到的都是上一次 `change` 的读数。不监听时读到的是最新读数，在你的代码返回之前保持不变。
- 读数的用量和速率是自上一次读数以来测得的。第一次读数、以及停了一阵之后的第一次读数，是在它之前的一小段时间里测的（没有读数在来时去读，会等这一小段时间，不到一秒：隔 2 秒以上才读一次的话，监听 `change`，不要用定时器去读）。

## 事件

每次读数都有 `change`。其它事件在它之后、按下面的顺序到来，条件是这次读数和内容拿到的上一次读数不同（上一次 `change` 的读数，或开始监听之前读到的）：

| 事件 | 何时 |
| --- | --- |
| `powerchange` | 插上或拔掉了电源，电池开始或停止充电、充满了，或低电量模式打开或关闭 |
| `thermalchange` | `thermal` 变了 |
| `networkchange` | Mac 联网或断网了，或者换了连接方式（连接是否 `expensive` 变了也算） |
| `memorypressurechange` | `memory.pressure` 变了 |
| `resume` | 内容被暂停之后又开始运行，见下文 |

除了 `resume` 都没有载荷：读属性即可，它们已经是新的读数。macOS 通知这些变化时，应用会立刻再读一次，不等到下一秒。

## 内容暂停的时候

内容暂停时什么都不会来：Mac 或它的显示器睡眠时、用户暂停所有内容（或只暂停你的内容）时，以及[性能与暂停](./performance)里的其它情况。重新运行时，`resume` 会告诉你暂停了多久：

```js
status.onresume = ({ suspendedAt, resumedAt, reason }) => {
  // reason：'sleep'（Mac 睡眠了）、'displaysleep'（显示器睡眠了）或 'paused'（用户或应用暂停了它）
  log(`离开了 ${Math.round((resumedAt - suspendedAt) / 60000)} 分钟`);
};
```

- `suspendedAt` 和 `resumedAt` 是自纪元起的毫秒数。期间 Mac 睡眠过，原因就是 `sleep`；否则显示器睡眠过就是 `displaysleep`；否则是 `paused`。
- 不管有没有监听其它事件，`resume` 都会来；只监听 `resume` 不会让读数持续进行。
- `resume` 之后，下一次读数带着 `change` 到来，暂停期间变了的也会补上对应的事件（例如期间拔掉了电源，就有 `powerchange`）。

## 没有权限时

没有权限（没有声明，或者用户拒绝了）时 `DesktopEngine.systemStatus` 为 `null`，在 API 低于 8 的应用里为 `undefined`。这时 `new DesktopEngineRuntime.SystemStatus()` 会抛出错误；有权限时只有一个，就是 `DesktopEngine.systemStatus`，再构造一个会抛出 `TypeError`。

## 在网页上

浏览器看不到 Mac：在网页预览（`desktopengine dev --web` 和商店）里，读数是模拟的，数值像真的 Mac 一样变化。在 `dev --web` 里，按菜单栏的 ⚡（内容有这个权限时才显示）可以让内容经历各种状态：各个 `thermal` 状态、离线和连接方式、内存压力和换出、用电池、接着电源或已充满、电量低或没有电池、低电量模式、未知的 `systemWatts` 或 `temperature`，还可以模拟 Mac 或显示器睡眠、内容被暂停 5 秒，结束时会有 `resume`。
