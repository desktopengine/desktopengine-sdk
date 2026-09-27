// DesktopEngine mini program JS API type declarations
//
// Compiled from the engine's native bindings; describes only what the runtime actually injects into the JSContext.
//
// Runtime environment:
// - The engine runs on JavaScriptCore with no DOM or Node.js, so do not use this file together with lib.dom or @types/node
//   (declarations such as console, setTimeout and require would conflict).
// - The entry index.js runs as a global script with only a global `require` (import and npm packages are available when `desktopengine build` bundles src/); modules loaded with `require()` are wrapped as
//   `function (module, exports, require) {...}`, and only there are `module` / `exports` available.
// - fetch, XMLHttpRequest and WebSocket are available; reaching the network needs the "network" permission in
//   manifest.json. Streams, Blob, FormData, URL and TextEncoder / TextDecoder are available too.
// - Audio and Web Audio (`new Audio(src)`, AudioContext) are available; sound needs the "audio" permission in manifest.json.
// - localStorage / sessionStorage and a Node-style file system (`DesktopEngine.fs`) keep data between launches.
// - Not implemented: DOM, import/ESM, IndexedDB, etc. (see https://desktopengine.github.io/desktopengine-sdk/guide/runtime).
//
// Usage: set `"types": []` in tsconfig and include this file, or use `/// <reference path="..." />` in JS.

/** DesktopEngine type declarations (the namespace holds types only; for runtime values, see the global DesktopEngine below) */
declare namespace DesktopEngine {
  // ---------------------------------------------------------------------------
  // Common types
  // ---------------------------------------------------------------------------

  /** A general callback with no return value */
  type VoidCallback = () => void;

  // ---------------------------------------------------------------------------
  // Launch options (DesktopEngine.launchOptions)
  // ---------------------------------------------------------------------------

  /** The display that shows the content; rectangles use the DesktopEngine.Window coordinate system: origin at the top-left of the main display, y pointing down */
  interface LaunchDisplay {
    /** Display ID (CGDirectDisplayID) */
    id: number;
    /** Display name, such as "Built-in Display" */
    name: string;
    /** The whole screen */
    frame: Rect;
    /** The usable area, excluding the menu bar and the Dock */
    visibleFrame: Rect;
    /** Pixel scale factor; 2 on Retina */
    scale: number;
  }

  /** The content type declared in manifest.json */
  type ContentType = 'wallpaper' | 'widget' | 'pet';

  /** A permission declared in manifest.json */
  type Permission = 'network' | 'files' | 'audio' | 'system-info' | 'now-playing' | 'window-positions';

  /** Widget size, matching WidgetKit: small 164×164, medium 344×164, large 344×344 */
  type WidgetSize = 'small' | 'medium' | 'large';

  /** Options passed by the app at launch; all fields are absent when loaded directly from the Develop menu */
  interface LaunchOptions {
    /** ID of this instance on the desktop; one package can have several instances */
    instanceId?: string;
    /** Content type */
    type?: ContentType;
    /** The level the user chose: pinned to the desktop, or floating above windows */
    level?: 'desktop' | 'floating';
    /** The window type to pass to `new DesktopEngine.Window({ type })` */
    windowType?: 'widget' | 'overlay';
    /** Widget size (widgets only) */
    size?: WidgetSize;
    /** Widget window width (points) */
    width?: number;
    /** Widget window height (points) */
    height?: number;
    /** The display that shows the content; absent when a wallpaper spans all displays (`displays`) */
    display?: LaunchDisplay;
    /**
     * Every display, the main one first, when the user runs a wallpaper across all of them; only for wallpapers
     * whose manifest.json declares `"wallpaper": { "span": true }`. Make a desktop window on each and lay the
     * drawing out in their shared coordinates, so it continues from one display to the next
     */
    displays?: LaunchDisplay[];
    /** Top-left position of the window: where the user last dragged it, or a default computed by the app */
    position?: { x: number; y: number };
    /** Values of the parameters in manifest.json (the user's value if set, otherwise the default) */
    parameters?: Record<string, boolean | number | string | null>;
    /** The user's preferred language, such as "zh-Hans-CN" */
    locale?: string;
    /**
     * The permissions the content runs with: the ones in manifest.json the user allowed. Denied ones are missing,
     * the content still runs without them. `audio` isn't asked about, it's there when declared.
     */
    permissions?: Permission[];
    /**
     * Present when a wallpaper runs as the macOS screen saver instead of on the desktop. The desktop window
     * fills the screen saver; there's no pointer or keyboard input (any input ends the screen saver) and JavaScript
     * runs without the JIT, so keep per-frame work on the GPU.
     */
    screenSaver?: LaunchScreenSaver;
  }

  /** How the content runs as the screen saver (`launchOptions.screenSaver`) */
  interface LaunchScreenSaver {
    /**
     * `true` in the small live preview of System Settings › Screen Saver: `devicePixelRatio` is lowered and frames are
     * limited to 30 per second, so the content renders fewer pixels; skip expensive effects
     */
    preview: boolean;
  }

  /**
   * A message sent to the app with the global `postMessage('host', message)`.
   * - `move`: reports the new position after the window is dragged; the app remembers it and passes it back in `launchOptions.position` on the next launch
   * - `close`: asks the app to remove this content from the desktop
   */
  type HostMessage =
    | { type: 'move'; x: number; y: number }
    | { type: 'close' };

  /** Event callback: `this` is the object that fired the event, and the argument is a plain object passed from native code (some events have no argument) */
  type EventHandler<T, P> = (this: T, payload: P) => void;

  /** Base class for native objects that support events */
  interface EventedObject<M> {
    /** Adds an event listener; `type` may be given with or without the `on` prefix */
    addEventListener<K extends keyof M & string>(type: K | `on${K}`, listener: EventHandler<this, M[K]>): void;
    /** Removes the given event listener */
    removeEventListener<K extends keyof M & string>(type: K | `on${K}`, listener: EventHandler<this, M[K]>): void;
    /** Clears all event listeners and on callbacks so the object can be garbage-collected; components also process their children recursively */
    destroy(): void;
  }

  // ---------------------------------------------------------------------------
  // Styles (Yoga layout + basic visual properties)
  // ---------------------------------------------------------------------------

  /** A length: a number (pt), a numeric string, `"10px"`, or a percentage `"50%"`; treated as unset if it can't be parsed */
  type StyleLength = number | `${number}` | `${number}px` | `${number}%`;

  /** A color: `#RGB`/`#RGBA`/`#RRGGBB`/`#RRGGBBAA`, `rgb()`/`rgba()`, a color name, or a 0xRRGGBB number */
  type StyleColor = string | number;

  /**
   * Positioning type: `relative` offsets the view by left/top/right/bottom and positions absolute descendants;
   * `static` ignores the offsets and absolute descendants skip it for the nearest positioned ancestor
   */
  type PositionType = 'relative' | 'absolute' | 'static';
  /**
   * Display type: `none` hides the view; `contents` lays its children out as its parent's, without a box of its own:
   * no background, opacity or clipping, and no click, mouseenter, mouseleave or mousemove of its own (listen on the
   * children). Components that draw their own content (Canvas, Image, Video) are hidden by `contents`, as on the web;
   * a Window, which has no parent, keeps its box, as the root element does
   */
  type Display = 'flex' | 'none' | 'contents';
  /** Overflow behavior; clips subviews when not visible */
  type Overflow = 'visible' | 'hidden' | 'scroll';
  /** Layout direction */
  type Direction = 'inherit' | 'ltr' | 'rtl';
  /** Main axis direction */
  type FlexDirection = 'column' | 'column-reverse' | 'row' | 'row-reverse';
  /** Main axis alignment */
  type Justify = 'flex-start' | 'center' | 'flex-end' | 'space-between' | 'space-around' | 'space-evenly';
  /** Cross axis alignment of items */
  type Align = 'auto' | 'flex-start' | 'center' | 'flex-end' | 'stretch' | 'baseline';
  /** Cross axis alignment of the lines of a wrapping container */
  type AlignContent = 'flex-start' | 'center' | 'flex-end' | 'stretch' | 'space-between' | 'space-around' | 'space-evenly';
  /** Wrapping behavior (note: `no-wrap`, not `nowrap`) */
  type FlexWrap = 'no-wrap' | 'wrap' | 'wrap-reverse';
  /** What width and height measure: `border-box` includes the padding, `content-box` doesn't */
  type BoxSizing = 'border-box' | 'content-box';
  /**
   * How a canvas' drawing buffer is scaled to its size (CSS image-rendering): `auto` smooths; `pixelated` keeps pixels
   * sharp when scaling up, for pixel art drawn 1:1 in a small buffer; `crisp-edges` keeps them sharp scaling down too
   */
  type ImageRendering = 'auto' | 'pixelated' | 'crisp-edges';

  /** Component style dictionary (the `style` constructor option, or assigning the whole object with `component.style = {...}`) */
  interface StyleProperties {
    /** Positioning type; defaults to relative */
    position?: PositionType;
    /** Display type; defaults to flex; none hides the view, contents gives its children to its parent's layout */
    display?: Display;
    /** Overflow behavior; defaults to hidden */
    overflow?: Overflow;
    /** Layout direction; defaults to ltr */
    direction?: Direction;
    /** Main axis direction; defaults to row (as on the web, unlike React Native) */
    flexDirection?: FlexDirection;
    /** Main axis alignment; defaults to flex-start */
    justifyContent?: Justify;
    /** Cross axis alignment of lines; defaults to stretch */
    alignContent?: AlignContent;
    /** Cross axis alignment of children; defaults to stretch */
    alignItems?: Align;
    /** Cross axis alignment of this item; defaults to auto */
    alignSelf?: Align;
    /** Wrapping behavior; defaults to no-wrap */
    flexWrap?: FlexWrap;
    /** What width and height measure; defaults to border-box (unlike the web) */
    boxSizing?: BoxSizing;
    /** flex shorthand (numbers only) */
    flex?: number | `${number}`;
    /** Grow factor */
    flexGrow?: number | `${number}`;
    /** Shrink factor; defaults to 1 */
    flexShrink?: number | `${number}`;
    /** Main axis base size; defaults to auto */
    flexBasis?: StyleLength;
    /** Left offset */
    left?: StyleLength;
    /** Top offset */
    top?: StyleLength;
    /** Right offset */
    right?: StyleLength;
    /** Bottom offset */
    bottom?: StyleLength;
    /** Start edge offset (follows direction) */
    start?: StyleLength;
    /** End edge offset (follows direction) */
    end?: StyleLength;
    /** Left margin */
    marginLeft?: StyleLength;
    /** Top margin */
    marginTop?: StyleLength;
    /** Right margin */
    marginRight?: StyleLength;
    /** Bottom margin */
    marginBottom?: StyleLength;
    /** Start edge margin */
    marginStart?: StyleLength;
    /** End edge margin */
    marginEnd?: StyleLength;
    /** Left padding */
    paddingLeft?: StyleLength;
    /** Top padding */
    paddingTop?: StyleLength;
    /** Right padding */
    paddingRight?: StyleLength;
    /** Bottom padding */
    paddingBottom?: StyleLength;
    /** Start edge padding */
    paddingStart?: StyleLength;
    /** End edge padding */
    paddingEnd?: StyleLength;
    /** Width; defaults to auto */
    width?: StyleLength;
    /** Height; defaults to auto */
    height?: StyleLength;
    /** Minimum width */
    minWidth?: StyleLength;
    /** Minimum height */
    minHeight?: StyleLength;
    /** Maximum width */
    maxWidth?: StyleLength;
    /** Maximum height */
    maxHeight?: StyleLength;
    /** Aspect ratio */
    aspectRatio?: number | `${number}`;
    /** Space between rows and between columns of children; percentages are of the container's inner size */
    gap?: StyleLength;
    /** Space between rows (lines of a wrapping row, or items of a column); overrides gap */
    rowGap?: StyleLength;
    /** Space between columns (items of a row, or lines of a wrapping column); overrides gap */
    columnGap?: StyleLength;
    /** Background color */
    backgroundColor?: StyleColor;
    /** Opacity from 0 to 1; defaults to 1 */
    opacity?: number;
    /** Canvas only: how its drawing buffer is scaled to its size; defaults to auto */
    imageRendering?: ImageRendering;
  }

  /** A style value (returned as stored when read; null if unset) */
  type StyleValue = string | number | null;

  /** The style object returned by `component.style`; assigning a single property merges it into the current style and updates; assigning null removes it */
  interface ComponentStyle {
    /** Reads or writes all styles as `key: value;` text; assigning replaces the whole style */
    cssText: string;
    /** Positioning type */
    position: PositionType | null;
    /** Display type */
    display: Display | null;
    /** Overflow behavior */
    overflow: Overflow | null;
    /** Layout direction */
    direction: Direction | null;
    /** Main axis direction */
    flexDirection: FlexDirection | null;
    /** Main axis alignment */
    justifyContent: Justify | null;
    /** Cross axis alignment of lines */
    alignContent: AlignContent | null;
    /** Cross axis alignment of children */
    alignItems: Align | null;
    /** Cross axis alignment of this item */
    alignSelf: Align | null;
    /** Wrapping behavior */
    flexWrap: FlexWrap | null;
    /** What width and height measure */
    boxSizing: BoxSizing | null;
    /** flex shorthand */
    flex: StyleValue;
    /** Grow factor */
    flexGrow: StyleValue;
    /** Shrink factor */
    flexShrink: StyleValue;
    /** Main axis base size */
    flexBasis: StyleValue;
    /** Left offset */
    left: StyleValue;
    /** Top offset */
    top: StyleValue;
    /** Right offset */
    right: StyleValue;
    /** Bottom offset */
    bottom: StyleValue;
    /** Start edge offset */
    start: StyleValue;
    /** End edge offset */
    end: StyleValue;
    /** Left margin */
    marginLeft: StyleValue;
    /** Top margin */
    marginTop: StyleValue;
    /** Right margin */
    marginRight: StyleValue;
    /** Bottom margin */
    marginBottom: StyleValue;
    /** Left padding */
    paddingLeft: StyleValue;
    /** Top padding */
    paddingTop: StyleValue;
    /** Right padding */
    paddingRight: StyleValue;
    /** Bottom padding */
    paddingBottom: StyleValue;
    /** Width */
    width: StyleValue;
    /** Height */
    height: StyleValue;
    /** Minimum width */
    minWidth: StyleValue;
    /** Minimum height */
    minHeight: StyleValue;
    /** Maximum width */
    maxWidth: StyleValue;
    /** Maximum height */
    maxHeight: StyleValue;
    /** Aspect ratio */
    aspectRatio: StyleValue;
    /** Space between rows and columns */
    gap: StyleValue;
    /** Space between rows */
    rowGap: StyleValue;
    /** Space between columns */
    columnGap: StyleValue;
    /** Background color */
    backgroundColor: StyleValue;
    /** Opacity */
    opacity: StyleValue;
    /** Canvas only: how its drawing buffer is scaled to its size */
    imageRendering: ImageRendering | null;
  }

  // ---------------------------------------------------------------------------
  // Event payloads (all plain objects, not DOM Events)
  // ---------------------------------------------------------------------------

  /** framechange payload: the frame after layout */
  interface FrameChangePayload {
    /** x relative to the parent component */
    x: number;
    /** y relative to the parent component */
    y: number;
    /** Width */
    width: number;
    /** Height */
    height: number;
  }

  /** click / dbclick payload */
  interface ClickPayload {
    /** Click position (in the component's coordinate system, origin at the top-left) */
    position: { x: number; y: number };
  }

  /** Mouse event payload */
  interface MousePayload {
    /** x in the component's coordinate system */
    x: number;
    /** y in the component's coordinate system */
    y: number;
    /** Whether Control is pressed */
    ctrlKey: boolean;
    /** Whether Option is pressed */
    altKey: boolean;
    /** Whether Command is pressed */
    metaKey: boolean;
    /** Whether Shift is pressed */
    shiftKey: boolean;
  }

  /** wheel payload (fired only while the window is the key window) */
  interface WheelPayload {
    /** Horizontal scroll delta */
    deltaX: number;
    /** Vertical scroll delta */
    deltaY: number;
    /** Z-axis scroll delta */
    deltaZ: number;
  }

  /** Keyboard event payload */
  interface KeyboardPayload {
    /** macOS virtual key code (NSEvent.keyCode) */
    code: number;
    /** The characters typed */
    characters: string;
    /** Whether this is a key repeat from holding the key down */
    repeat: boolean;
    /** Whether Control is pressed */
    ctrlKey: boolean;
    /** Whether Option is pressed */
    altKey: boolean;
    /** Whether Command is pressed */
    metaKey: boolean;
    /** Whether Shift is pressed */
    shiftKey: boolean;
  }

  /** Window move payload (screen coordinates, origin at the top-left of the main screen) */
  interface MovePayload {
    /** x of the window's top-left corner */
    x: number;
    /** y of the window's top-left corner */
    y: number;
  }

  /** Error event payload */
  interface ErrorPayload {
    /** Error description */
    errMsg: string;
  }

  /** Component event map */
  interface ComponentEventMap {
    /** Layout frame changed */
    framechange: FrameChangePayload;
    /** Single click */
    click: ClickPayload;
    /** Double click (the event name is dbclick, not dblclick) */
    dbclick: ClickPayload;
    /** Mouse button pressed */
    mousedown: MousePayload;
    /** Mouse button released */
    mouseup: MousePayload;
    /** Mouse entered */
    mouseenter: MousePayload;
    /** Mouse exited */
    mouseleave: MousePayload;
    /** Mouse moved */
    mousemove: MousePayload;
    /** Scroll wheel */
    wheel: WheelPayload;
  }

  /** Window event map */
  interface WindowEventMap extends ComponentEventMap {
    /** The window became visible (occlusion state changed) */
    show: void;
    /** The window became invisible (occlusion state changed) */
    hide: void;
    /** The window is about to close */
    close: void;
    /** Fired after the user resizes the window (no argument; read width/height) */
    resize: void;
    /** Fired after the user moves the window */
    move: MovePayload;
    /** The window became the main window */
    focus: void;
    /** The window stopped being the main window */
    blur: void;
    /** A key was pressed (once listened to, the key is not passed further down) */
    keydown: KeyboardPayload;
    /** A key was released (once listened to, the key is not passed further down) */
    keyup: KeyboardPayload;
    /** devicePixelRatio changed: the window moved to a display with another scale, or the display's scale changed */
    devicepixelratiochange: void;
  }

  /** Video progress payload */
  interface VideoProgressPayload {
    /** Percentage buffered, from 0 to 100 */
    buffered: number;
    /** Total duration (seconds) */
    duration: number;
  }

  /** Video timeupdate payload */
  interface VideoTimeUpdatePayload {
    /** Current playback position (seconds) */
    position: number;
    /** Total duration (seconds) */
    duration: number;
  }

  /** Video event map */
  interface VideoEventMap extends ComponentEventMap {
    /** Waiting for buffering */
    waiting: void;
    /** Buffering progress */
    progress: VideoProgressPayload;
    /** Playback started */
    play: void;
    /** Paused */
    pause: void;
    /** Playback ended */
    ended: void;
    /** Playback progress */
    timeupdate: VideoTimeUpdatePayload;
    /** Playback failed */
    error: ErrorPayload;
  }

  /** Image event map */
  interface ImageEventMap extends ComponentEventMap {
    /** The image finished loading */
    load: void;
    /** The image failed to load */
    error: ErrorPayload;
  }

  /** CanvasImage event map */
  interface CanvasImageEventMap {
    /** The texture finished loading */
    load: void;
    /** The texture failed to load (no argument) */
    error: void;
  }

  /** Appearance of the system: follows the light / dark setting in System Settings › Appearance */
  type Appearance = 'light' | 'dark';

  /** System event map */
  interface SystemEventMap {
    /** The system appearance changed (the user switched it, or Auto switched it at sunset / sunrise) */
    appearancechange: { appearance: Appearance };
  }

  /** ScreenManager event map */
  interface ScreenManagerEventMap {
    /** The screen configuration changed (displays connected or disconnected, resolution, etc.) */
    change: void;
  }

  // ---------------------------------------------------------------------------
  // Component
  // ---------------------------------------------------------------------------

  /** Component constructor options; fields other than style / events are stored as native attributes */
  interface ComponentOptions {
    /** Initial style */
    style?: StyleProperties;
    /** Event names to enable on the native side up front (JS still needs a callback to receive them) */
    events?: string[];
  }

  /** Members shared by all components (Component, Window, Video, Image, Canvas) */
  interface ComponentBase<M extends ComponentEventMap> extends EventedObject<M> {
    /** Unique identifier of the native component (a pointer string) */
    readonly identifier: string;
    /** Reading returns the style object; assigning an object replaces the whole style */
    get style(): ComponentStyle;
    set style(value: StyleProperties);
    /** Width after layout (reading triggers layout first) */
    readonly width: number;
    /** Height after layout (reading triggers layout first) */
    readonly height: number;
    /** Array of child components (each read returns a new array) */
    readonly children: AnyComponent[];
    /** Adds a child component at `index` (0 to the number of children); omit it or pass -1 to append at the end. Throws a RangeError for other indexes; a Window can't be a child */
    appendChild(child: AnyComponent, index?: number): void;
    /** Removes a child component; throws if it isn't a child of this component */
    removeChild(child: AnyComponent): void;
    /** Removes this component from its parent */
    remove(): void;

    /** framechange callback */
    onframechange: EventHandler<this, FrameChangePayload> | null | undefined;
    /** click callback */
    onclick: EventHandler<this, ClickPayload> | null | undefined;
    /** dbclick (double-click) callback */
    ondbclick: EventHandler<this, ClickPayload> | null | undefined;
    /** mousedown callback */
    onmousedown: EventHandler<this, MousePayload> | null | undefined;
    /** mouseup callback */
    onmouseup: EventHandler<this, MousePayload> | null | undefined;
    /** mouseenter callback */
    onmouseenter: EventHandler<this, MousePayload> | null | undefined;
    /** mouseleave callback */
    onmouseleave: EventHandler<this, MousePayload> | null | undefined;
    /** mousemove callback, also while a press that began on the component is dragged, unless the press moves the window (see Window.dragRegion) */
    onmousemove: EventHandler<this, MousePayload> | null | undefined;
    /** wheel callback */
    onwheel: EventHandler<this, WheelPayload> | null | undefined;
    /** Removes the onframechange callback */
    offframechange(): void;
    /** Removes the onclick callback */
    offclick(): void;
    /** Removes the ondbclick callback */
    offdbclick(): void;
    /** Removes the onmousedown callback */
    offmousedown(): void;
    /** Removes the onmouseup callback */
    offmouseup(): void;
    /** Removes the onmouseenter callback */
    offmouseenter(): void;
    /** Removes the onmouseleave callback */
    offmouseleave(): void;
    /** Removes the onmousemove callback */
    offmousemove(): void;
    /** Removes the onwheel callback */
    offwheel(): void;
  }

  /** Basic view component (a Yoga layout container) */
  interface Component extends ComponentBase<ComponentEventMap> {}

  /** Any component instance */
  type AnyComponent = Component | Window | Video | Image | Canvas;

  /** Component constructor (call only with new; supports instanceof) */
  interface ComponentConstructor {
    /** Creates a component */
    new (options?: ComponentOptions): Component;
  }

  // ---------------------------------------------------------------------------
  // Window
  // ---------------------------------------------------------------------------

  /**
   * Window types:
   * - desktop: desktop level (wallpapers), below the desktop icons, visible in all Spaces
   * - widget: a widget pinned to the desktop, above the desktop icons, borderless with a transparent background, draggable
   * - overlay: floats above all windows, borderless with a transparent background, visible in all Spaces (floating widgets, desktop pets)
   * - panel: a floating panel (with a title bar)
   * - normal: a regular window (default)
   * desktop, widget and overlay windows don't activate the app when shown, so they don't take focus from the current app.
   */
  type WindowType = 'desktop' | 'widget' | 'overlay' | 'panel' | 'normal';

  /** Window constructor options */
  interface WindowOptions extends ComponentOptions {
    /**
     * Window type; defaults to a regular window. The content's type limits it and `new` throws for the others:
     * a wallpaper makes desktop windows, widgets and pets widget and overlay windows (`launchOptions.windowType`)
     */
    type?: WindowType;
    /** Parent window; the new window is shown above it as a child window */
    parent?: Window;
  }

  /** A native window (NSWindow) that is the root of a component tree; left/top/width/height in its style map to the window's position and size */
  interface Window extends ComponentBase<WindowEventMap> {
    /** Screen scale factor (backingScaleFactor); uses the main screen while the window isn't shown. Changes with the display (devicepixelratiochange) */
    readonly devicePixelRatio: number;
    /** Parent window; assign null to detach */
    parentWindow: Window | null;
    /** Array of child windows */
    readonly childWindows: Window[];
    /**
     * The parts of the window that take the mouse, in points from its top left corner. Elsewhere clicks, drags and hovering
     * go through to whatever is below, e.g. around the shape of a desktop pet. null (default): the whole window.
     * Rectangles without a positive size are left out.
     */
    hitRegion: Rect[] | null;
    /**
     * For widget and overlay windows, which move when dragged: the parts that move the window, in points from its top left
     * corner. Elsewhere a press and its drag go to the components (mousedown, mousemove while the button is down, mouseup),
     * e.g. for a dial or a slider. null (default): the whole window; [] : none. Other window types ignore it.
     * Rectangles without a positive size are left out.
     */
    dragRegion: Rect[] | null;
    /**
     * Whether macOS may tile the window, e.g. to half the screen when it's dropped on a screen edge. false (default): it
     * keeps its size and where it was dropped. Tiling from the Window menu, a keyboard shortcut or a title bar double
     * click set to fill is undone too; resizing by the edges, zooming and full screen aren't affected.
     */
    allowsTiling: boolean;
    /** Shows the window and activates the app */
    show(): void;
    /** Closes the window (fires close) */
    close(): void;
    /** Releases listeners and drops the strong reference to the JS object; a window stays retained after creation until this is called */
    destroy(): void;
    /**
     * Window doesn't support remove
     * @remarks Unconfirmed: the name clashes with Component.remove, and calling it may log a not-implemented warning
     */
    remove(): void;

    /** show callback */
    onshow: EventHandler<this, void> | null | undefined;
    /** hide callback */
    onhide: EventHandler<this, void> | null | undefined;
    /** close callback */
    onclose: EventHandler<this, void> | null | undefined;
    /** resize callback */
    onresize: EventHandler<this, void> | null | undefined;
    /** move callback */
    onmove: EventHandler<this, MovePayload> | null | undefined;
    /** focus callback (not supported by the desktop type) */
    onfocus: EventHandler<this, void> | null | undefined;
    /** blur callback (not supported by the desktop type) */
    onblur: EventHandler<this, void> | null | undefined;
    /** keydown callback (not supported by the desktop type) */
    onkeydown: EventHandler<this, KeyboardPayload> | null | undefined;
    /** keyup callback (not supported by the desktop type) */
    onkeyup: EventHandler<this, KeyboardPayload> | null | undefined;
    /** devicepixelratiochange callback */
    ondevicepixelratiochange: EventHandler<this, void> | null | undefined;
    /** Removes the onshow callback */
    offshow(): void;
    /** Removes the onhide callback */
    offhide(): void;
    /** Removes the onclose callback */
    offclose(): void;
    /** Removes the onresize callback */
    offresize(): void;
    /** Removes the onmove callback */
    offmove(): void;
    /** Removes the onfocus callback */
    offfocus(): void;
    /** Removes the onblur callback */
    offblur(): void;
    /** Removes the onkeydown callback */
    offkeydown(): void;
    /** Removes the onkeyup callback */
    offkeyup(): void;
    /** Removes the ondevicepixelratiochange callback */
    offdevicepixelratiochange(): void;
  }

  /** Window constructor */
  interface WindowConstructor {
    /** Creates a window (call show() to display it) */
    new (options?: WindowOptions): Window;
  }

  // ---------------------------------------------------------------------------
  // Video
  // ---------------------------------------------------------------------------

  /** Video scaling mode */
  type VideoObjectFit = 'contain' | 'cover' | 'fill';

  /** Video constructor options */
  interface VideoOptions extends ComponentOptions {
    /** Video source: an http(s) URL or a path inside the package or sandbox */
    src?: string;
    /** Initial playback position (seconds); defaults to 0 */
    initialTime?: number;
    /** Playback rate; defaults to 1.0 */
    playbackRate?: number;
    /** Scaling mode; defaults to contain */
    objectFit?: VideoObjectFit;
    /** Whether to play automatically; defaults to false */
    autoplay?: boolean;
    /** Whether to loop; defaults to false */
    loop?: boolean;
    /** Whether to mute; defaults to false */
    muted?: boolean;
    /** Volume from 0 to 1; defaults to 1.0 */
    volume?: number;
  }

  /** Video playback component (AVPlayer); pauses automatically when the runtime is suspended and resumes afterwards */
  interface Video extends ComponentBase<VideoEventMap> {
    /** Video source (returns the value as it was set) */
    src: string | null;
    /** Initial playback position (seconds); accepts numbers only */
    initialTime: number;
    /** Scaling mode */
    objectFit: VideoObjectFit;
    /** Playback rate; accepts numbers only */
    playbackRate: number;
    /** Whether to play automatically; accepts booleans only */
    autoplay: boolean;
    /** Whether to loop; accepts booleans only */
    loop: boolean;
    /** Whether to mute; accepts booleans only */
    muted: boolean;
    /** Volume from 0 to 1; accepts numbers only */
    volume: number;
    /** Starts playback */
    play(): void;
    /** Pauses playback */
    pause(): void;
    /** Seeks to the given time (seconds); throws a TypeError if it isn't a finite number */
    seek(time: number): void;

    /** waiting callback */
    onwaiting: EventHandler<this, void> | null | undefined;
    /** progress callback */
    onprogress: EventHandler<this, VideoProgressPayload> | null | undefined;
    /** play callback */
    onplay: EventHandler<this, void> | null | undefined;
    /** pause callback */
    onpause: EventHandler<this, void> | null | undefined;
    /** ended callback */
    onended: EventHandler<this, void> | null | undefined;
    /** timeupdate callback */
    ontimeupdate: EventHandler<this, VideoTimeUpdatePayload> | null | undefined;
    /** error callback */
    onerror: EventHandler<this, ErrorPayload> | null | undefined;
    /** Removes the onwaiting callback */
    offwaiting(): void;
    /** Removes the onprogress callback */
    offprogress(): void;
    /** Removes the onplay callback */
    offplay(): void;
    /** Removes the onpause callback */
    offpause(): void;
    /** Removes the onended callback */
    offended(): void;
    /** Removes the ontimeupdate callback */
    offtimeupdate(): void;
    /** Removes the onerror callback */
    offerror(): void;
  }

  /** Video constructor */
  interface VideoConstructor {
    /** Creates a video component */
    new (options?: VideoOptions): Video;
  }

  // ---------------------------------------------------------------------------
  // Image (view component)
  // ---------------------------------------------------------------------------

  /** Image scaling mode; defaults to contain */
  type ImageSize = 'contain' | 'cover';
  /** Image alignment; defaults to center */
  type ImagePosition = 'top' | 'left' | 'center' | 'bottom' | 'right' | 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';

  /** Image constructor options */
  interface ImageOptions extends ComponentOptions {
    /** Image source: an http(s) URL or a path inside the package or sandbox */
    src?: string;
    /** Scaling mode */
    size?: ImageSize;
    /** Alignment */
    position?: ImagePosition;
  }

  /** Image view component */
  interface Image extends ComponentBase<ImageEventMap> {
    /** Image source (returns the value as it was set) */
    src: string | null;
    /** Scaling mode */
    size: ImageSize;
    /** Alignment */
    position: ImagePosition;

    /** Called when the image of a src has loaded, once for each src set (the same one again too); changing position or size doesn't load it again */
    onload: EventHandler<this, void> | null | undefined;
    /**
     * Called when a src can't be shown: a file that can't be read, a URL the image doesn't load (data: URLs, a path
     * out of the package) or an http(s) URL without the "network" permission. A src replaced before it loaded calls
     * neither callback.
     */
    onerror: EventHandler<this, ErrorPayload> | null | undefined;
    /** Removes the onload callback */
    offload(): void;
    /** Removes the onerror callback */
    offerror(): void;
  }

  /** Image constructor */
  interface ImageConstructor {
    /** Creates an image component */
    new (options?: ImageOptions): Image;
  }

  // ---------------------------------------------------------------------------
  // Canvas
  // ---------------------------------------------------------------------------

  /** Optional options for getContext */
  interface CanvasContextOptions {
    /** Whether to enable multisample antialiasing (up to 4x) */
    antialias?: boolean;
    /** Whether the canvas has an alpha channel, true by default (as on the web); full-screen wallpapers pass false,
     * an opaque layer composites with less power */
    alpha?: boolean;
  }

  /** Objects that can be a source for drawImage / createPattern / texImage2D */
  type CanvasDrawable = Canvas | CanvasImage | ImageData;

  /**
   * Canvas component (implemented with OpenGL ES/ANGLE on Metal); defaults to 300x150 when no style is given.
   * On Macs whose GPU doesn't support Metal every getContext returns null and CanvasImage fails to load.
   */
  interface Canvas extends ComponentBase<ComponentEventMap> {
    /** Drawing buffer width (pixels, 2 to 16383); uses the layout width if unset. The style only sets the displayed size: the buffer is stretched over it, like on the web */
    width: number;
    /** Drawing buffer height (pixels, 2 to 16383); uses the layout height if unset */
    height: number;
    /** Gets a 2D context; a canvas can use only one kind of context, and switching returns null */
    getContext(type: '2d', options?: CanvasContextOptions): CanvasRenderingContext2D | null;
    /** Gets a WebGL 1 context (a name containing webgl that isn't webgl2, such as experimental-webgl) */
    getContext(type: 'webgl' | 'experimental-webgl', options?: CanvasContextOptions): WebGLRenderingContext | null;
    /** Gets a WebGL 2 context (exactly 'webgl2'), backed by an OpenGL ES 3.0 ANGLE context */
    getContext(type: 'webgl2', options?: CanvasContextOptions): WebGL2RenderingContext | null;
    /** Returns null for unsupported types (such as experimental-webgl2 or webgpu) */
    getContext(type: string, options?: CanvasContextOptions): CanvasRenderingContext2D | WebGLRenderingContext | WebGL2RenderingContext | null;
  }

  /** Canvas constructor */
  interface CanvasConstructor {
    /** Creates a canvas component */
    new (options?: ComponentOptions): Canvas;
  }

  /** A canvas image texture (similar to HTMLImageElement; used only for canvas drawing, not a view) */
  interface CanvasImage extends EventedObject<CanvasImageEventMap> {
    /**
     * Image source: an http(s) URL, a data URI or a FilePath (in the package, like `/a.png`, `./a.png` or `a.png`, or in the
     * sandbox); other paths fire error. Assign an empty string to release the texture
     */
    src: string;
    /** Texture width */
    readonly width: number;
    /** Texture height */
    readonly height: number;
    /** Whether the image loaded successfully */
    readonly complete: boolean;
    /** Always "IMG" */
    readonly nodeName: string;
    /** Always "IMG" */
    readonly tagName: string;
    /** Loads a local image (a FilePath) synchronously, with deferred decoding, then fires load or error */
    loadFromLocal(path: FilePath): void;

    /** load callback */
    onload: EventHandler<this, void> | null | undefined;
    /** error callback */
    onerror: EventHandler<this, void> | null | undefined;
    /** Removes the onload callback */
    offload(): void;
    /** Removes the onerror callback */
    offerror(): void;
  }

  /** CanvasImage constructor */
  interface CanvasImageConstructor {
    /** Creates a canvas image */
    new (): CanvasImage;
  }

  /** Pixel data (obtainable only through createImageData / getImageData) */
  interface ImageData {
    /** RGBA pixels (not premultiplied), generated on first read */
    readonly data: Uint8ClampedArray;
    /** Width */
    readonly width: number;
    /** Height */
    readonly height: number;
  }

  /** Gradient object */
  interface CanvasGradient {
    /** Adds a color stop (a CSS color, see CanvasRenderingContext2D.fillStyle); invalid colors are ignored */
    addColorStop(offset: number, color: string): void;
  }

  /** Pattern object */
  interface CanvasPattern {}

  /** Text metrics */
  interface TextMetrics {
    /** Text width */
    readonly width: number;
    /** Height above the baseline */
    readonly actualBoundingBoxAscent: number;
    /** Height below the baseline */
    readonly actualBoundingBoxDescent: number;
  }

  /** Compositing mode */
  type GlobalCompositeOperation =
    | 'source-over' | 'lighter' | 'lighten' | 'darker' | 'darken' | 'destination-out' | 'destination-over'
    | 'source-atop' | 'xor' | 'copy' | 'source-in' | 'destination-in' | 'source-out' | 'destination-atop';
  /** Line cap */
  type CanvasLineCap = 'butt' | 'round' | 'square';
  /** Line join */
  type CanvasLineJoin = 'miter' | 'bevel' | 'round';
  /** Text baseline */
  type CanvasTextBaseline = 'alphabetic' | 'middle' | 'top' | 'hanging' | 'bottom' | 'ideographic';
  /** Text alignment */
  type CanvasTextAlign = 'start' | 'end' | 'left' | 'center' | 'right';
  /** Fill rule */
  type CanvasFillRule = 'nonzero' | 'evenodd';
  /** Pattern repetition */
  type CanvasPatternRepetition = 'repeat' | 'repeat-x' | 'repeat-y' | 'no-repeat';

  /** 2D rendering context (Canvas2DRenderingContext); largely the same interface as on the web; Path2D isn't supported */
  interface CanvasRenderingContext2D {
    /** The owning canvas */
    readonly canvas: Canvas | null;
    /** Compositing mode */
    globalCompositeOperation: GlobalCompositeOperation;
    /** Line cap */
    lineCap: CanvasLineCap;
    /** Line join */
    lineJoin: CanvasLineJoin;
    /** Text alignment */
    textAlign: CanvasTextAlign;
    /** Text baseline */
    textBaseline: CanvasTextBaseline;
    /**
     * Fill style. Colors: `#rgb`, `#rgba`, `#rrggbb`, `#rrggbbaa`, `rgb()`/`rgba()` and `hsl()`/`hsla()` with commas or
     * spaces (`rgb(255 0 0 / 50%)`), or a CSS color name; invalid colors are ignored, like on the web.
     * Colors read back as an `rgba(r,g,b,a)` string
     */
    fillStyle: string | CanvasGradient | CanvasPattern;
    /** Stroke style, colors as for fillStyle; colors read back as an `rgba(r,g,b,a)` string */
    strokeStyle: string | CanvasGradient | CanvasPattern;
    /** Global alpha */
    globalAlpha: number;
    /** Line width */
    lineWidth: number;
    /** Miter limit */
    miterLimit: number;
    /**
     * Font, the CSS `font` shorthand: `[italic] [weight] size[/line-height] family[, family…]`, such as
     * `"600 14px system-ui"` or `"bold 16px 'Avenir Next', Helvetica"`; defaults to `10px Helvetica`.
     * - weight: `normal`, `bold` or 1–1000 (400 normal, 700 bold)
     * - size: px or pt; the line height is ignored
     * - family: the first installed one of the list. `system-ui` (also `-apple-system`, `BlinkMacSystemFont`,
     *   `ui-sans-serif`) is the system font, San Francisco with PingFang for Chinese; `ui-rounded`, `ui-monospace` and
     *   `ui-serif` are its rounded, monospaced and serif (New York) designs; `sans-serif`, `serif` and `monospace` are
     *   Helvetica, Times and Courier. Without an installed family the font keeps its family
     *
     * An invalid value is ignored. Reads back as `[italic ][weight ]<size>px <family>`, e.g. `600 14px system-ui`
     */
    font: string;
    /** Whether images are smoothed when scaled */
    imageSmoothingEnabled: boolean;
    /** Line dash offset */
    lineDashOffset: number;
    /** Shadow color, as for fillStyle (reads back as an `rgba()` string) */
    shadowColor: string;
    /** Shadow blur */
    shadowBlur: number;
    /** Shadow x offset */
    shadowOffsetX: number;
    /** Shadow y offset */
    shadowOffsetY: number;

    /** Saves the state */
    save(): void;
    /** Restores the state */
    restore(): void;
    /** Resets the current state (non-standard) */
    resetCurrentState(): void;
    /** Rotates (radians) */
    rotate(angle: number): void;
    /** Translates */
    translate(x: number, y: number): void;
    /** Scales */
    scale(x: number, y: number): void;
    /** Multiplies the current transform matrix */
    transform(a: number, b: number, c: number, d: number, e: number, f: number): void;
    /** Sets the transform matrix */
    setTransform(a: number, b: number, c: number, d: number, e: number, f: number): void;
    /** Resets the transform matrix to the identity */
    resetTransform(): void;
    /** Draws an image at (dx, dy) */
    drawImage(image: CanvasDrawable, dx: number, dy: number): void;
    /** Draws an image into the given rectangle */
    drawImage(image: CanvasDrawable, dx: number, dy: number, dw: number, dh: number): void;
    /** Crops the source rectangle and draws it into the destination rectangle */
    drawImage(image: CanvasDrawable, sx: number, sy: number, sw: number, sh: number, dx: number, dy: number, dw: number, dh: number): void;
    /** Fills a rectangle */
    fillRect(x: number, y: number, w: number, h: number): void;
    /** Strokes a rectangle */
    strokeRect(x: number, y: number, w: number, h: number): void;
    /** Clears a rectangle */
    clearRect(x: number, y: number, w: number, h: number): void;
    /** Reads pixels */
    getImageData(sx: number, sy: number, sw: number, sh: number): ImageData;
    /** Creates pixel data, optionally initialized from a Uint8ClampedArray (non-standard third argument) */
    createImageData(sw: number, sh: number, data?: Uint8ClampedArray): ImageData;
    /** Writes pixels */
    putImageData(imageData: ImageData, dx: number, dy: number): void;
    /** Creates a linear gradient */
    createLinearGradient(x0: number, y0: number, x1: number, y1: number): CanvasGradient;
    /** Creates a radial gradient */
    createRadialGradient(x0: number, y0: number, r0: number, x1: number, y1: number, r1: number): CanvasGradient;
    /** Creates a pattern; defaults to repeat */
    createPattern(image: CanvasDrawable, repetition?: CanvasPatternRepetition): CanvasPattern | undefined;
    /** Begins a path */
    beginPath(): void;
    /** Closes the path */
    closePath(): void;
    /** Fills the path */
    fill(fillRule?: CanvasFillRule): void;
    /** Strokes the path */
    stroke(): void;
    /** Moves the pen */
    moveTo(x: number, y: number): void;
    /** Draws a straight line */
    lineTo(x: number, y: number): void;
    /** Adds a rectangle to the path */
    rect(x: number, y: number, w: number, h: number): void;
    /** Cubic Bézier curve */
    bezierCurveTo(cp1x: number, cp1y: number, cp2x: number, cp2y: number, x: number, y: number): void;
    /** Quadratic Bézier curve */
    quadraticCurveTo(cpx: number, cpy: number, x: number, y: number): void;
    /** Arc tangent to two lines */
    arcTo(x1: number, y1: number, x2: number, y2: number, radius: number): void;
    /** Arc */
    arc(x: number, y: number, radius: number, startAngle: number, endAngle: number, counterclockwise?: boolean): void;
    /** Measures text */
    measureText(text: string): TextMetrics;
    /** Fills text */
    fillText(text: string, x: number, y: number, maxWidth?: number): void;
    /** Strokes text */
    strokeText(text: string, x: number, y: number, maxWidth?: number): void;
    /** Clips to the current path */
    clip(fillRule?: CanvasFillRule): void;
    /** Clears the clip (non-standard) */
    resetClip(): void;
    /** Gets the line dash pattern */
    getLineDash(): number[];
    /** Sets the line dash pattern */
    setLineDash(segments: Array<number | string>): void;
    /** Not implemented; calling it only logs a warning */
    isPointInPath(...args: unknown[]): undefined;
  }

  // ---------------------------------------------------------------------------
  // WebGL 1
  // ---------------------------------------------------------------------------

  /** GL enum */
  type GLenum = number;
  /** GL integer */
  type GLint = number;
  /** GL unsigned integer */
  type GLuint = number;
  /** GL size */
  type GLsizei = number;
  /** GL float */
  type GLfloat = number;
  /** GL bitmask */
  type GLbitfield = number;
  /** GL pointer offset */
  type GLintptr = number;
  /** Float array argument: a Float32Array or an array of numbers */
  type Float32List = Float32Array | ArrayLike<number>;
  /** Integer array argument: an Int32Array or an array of numbers */
  type Int32List = Int32Array | ArrayLike<number>;

  /** WebGL buffer object */
  interface WebGLBuffer { readonly __brand?: 'WebGLBuffer' }
  /** WebGL framebuffer object */
  interface WebGLFramebuffer { readonly __brand?: 'WebGLFramebuffer' }
  /** WebGL renderbuffer object */
  interface WebGLRenderbuffer { readonly __brand?: 'WebGLRenderbuffer' }
  /** WebGL texture object */
  interface WebGLTexture { readonly __brand?: 'WebGLTexture' }
  /** WebGL program object */
  interface WebGLProgram { readonly __brand?: 'WebGLProgram' }
  /** WebGL shader object */
  interface WebGLShader { readonly __brand?: 'WebGLShader' }
  /** WebGL uniform location */
  interface WebGLUniformLocation { readonly __brand?: 'WebGLUniformLocation' }
  /** WebGL vertex array object (OES_vertex_array_object) */
  interface WebGLVertexArrayObjectOES { readonly __brand?: 'WebGLVertexArrayObject' }

  /** attribute / uniform information */
  interface WebGLActiveInfo {
    /** Array size */
    readonly size: number;
    /** Type enum */
    readonly type: GLenum;
    /** Name */
    readonly name: string;
  }

  /** Shader precision information */
  interface WebGLShaderPrecisionFormat {
    /** Minimum range (log2) */
    readonly rangeMin: number;
    /** Maximum range (log2) */
    readonly rangeMax: number;
    /** Bits of precision */
    readonly precision: number;
  }

  /** The attributes the context really has (a plain object) */
  interface WebGLContextAttributes {
    /** The alpha option of getContext (true unless alpha: false) */
    readonly alpha: boolean;
    /** Always true: the drawing buffer has a depth buffer */
    readonly depth: boolean;
    /** Always true: the drawing buffer has an 8 bit stencil buffer */
    readonly stencil: boolean;
    /** Whether the drawing buffer is multisampled (the antialias option of getContext, when supported) */
    readonly antialias: boolean;
    /** Always true: the canvas is composited as premultiplied alpha */
    readonly premultipliedAlpha: boolean;
    /** Always false: the drawing buffer is cleared after being presented */
    readonly preserveDrawingBuffer: boolean;
    /** Always false */
    readonly failIfMajorPerformanceCaveat: boolean;
    /** Always false */
    readonly desynchronized: boolean;
    /** Always "default" */
    readonly powerPreference: 'default';
  }

  /** EXT_texture_filter_anisotropic extension */
  interface EXT_texture_filter_anisotropic {
    /** Maximum anisotropy */
    readonly MAX_TEXTURE_MAX_ANISOTROPY_EXT: GLenum;
    /** Texture anisotropy parameter */
    readonly TEXTURE_MAX_ANISOTROPY_EXT: GLenum;
  }
  /** OES_texture_half_float extension */
  interface OES_texture_half_float {
    /** Half-float type */
    readonly HALF_FLOAT_OES: GLenum;
  }
  /** OES_vertex_array_object extension */
  interface OES_vertex_array_object {
    /** Enum for querying the currently bound VAO */
    readonly VERTEX_ARRAY_BINDING_OES: GLenum;
    /** Creates a VAO */
    createVertexArrayOES(): WebGLVertexArrayObjectOES | null;
    /** Deletes a VAO */
    deleteVertexArrayOES(arrayObject: WebGLVertexArrayObjectOES | null): void;
    /** Returns whether the object is a VAO */
    isVertexArrayOES(arrayObject: WebGLVertexArrayObjectOES | null): boolean;
    /** Binds a VAO */
    bindVertexArrayOES(arrayObject: WebGLVertexArrayObjectOES | null): void;
  }
  /** ANGLE_instanced_arrays extension */
  interface ANGLE_instanced_arrays {
    /** Enum for querying the divisor */
    readonly VERTEX_ATTRIB_ARRAY_DIVISOR_ANGLE: GLenum;
    /** Draws arrays with instancing */
    drawArraysInstancedANGLE(mode: GLenum, first: GLint, count: GLsizei, primcount: GLsizei): void;
    /** Draws elements with instancing */
    drawElementsInstancedANGLE(mode: GLenum, count: GLsizei, type: GLenum, offset: GLintptr, primcount: GLsizei): void;
    /** Sets the instance divisor of an attribute */
    vertexAttribDivisorANGLE(index: GLuint, divisor: GLuint): void;
  }
  /** WEBGL_compressed_texture_pvrtc extension */
  interface WEBGL_compressed_texture_pvrtc {
    /** PVRTC RGB 4bpp */
    readonly COMPRESSED_RGB_PVRTC_4BPPV1_IMG: GLenum;
    /** PVRTC RGB 2bpp */
    readonly COMPRESSED_RGB_PVRTC_2BPPV1_IMG: GLenum;
    /** PVRTC RGBA 4bpp */
    readonly COMPRESSED_RGBA_PVRTC_4BPPV1_IMG: GLenum;
    /** PVRTC RGBA 2bpp */
    readonly COMPRESSED_RGBA_PVRTC_2BPPV1_IMG: GLenum;
  }
  /** WEBGL_compressed_texture_astc extension (Apple GPUs) */
  interface WEBGL_compressed_texture_astc {
    /** "ldr", plus "hdr" when the GPU decodes HDR blocks */
    getSupportedProfiles(): string[];
    readonly COMPRESSED_RGBA_ASTC_4x4_KHR: GLenum;
    readonly COMPRESSED_RGBA_ASTC_5x4_KHR: GLenum;
    readonly COMPRESSED_RGBA_ASTC_5x5_KHR: GLenum;
    readonly COMPRESSED_RGBA_ASTC_6x5_KHR: GLenum;
    readonly COMPRESSED_RGBA_ASTC_6x6_KHR: GLenum;
    readonly COMPRESSED_RGBA_ASTC_8x5_KHR: GLenum;
    readonly COMPRESSED_RGBA_ASTC_8x6_KHR: GLenum;
    readonly COMPRESSED_RGBA_ASTC_8x8_KHR: GLenum;
    readonly COMPRESSED_RGBA_ASTC_10x5_KHR: GLenum;
    readonly COMPRESSED_RGBA_ASTC_10x6_KHR: GLenum;
    readonly COMPRESSED_RGBA_ASTC_10x8_KHR: GLenum;
    readonly COMPRESSED_RGBA_ASTC_10x10_KHR: GLenum;
    readonly COMPRESSED_RGBA_ASTC_12x10_KHR: GLenum;
    readonly COMPRESSED_RGBA_ASTC_12x12_KHR: GLenum;
    readonly COMPRESSED_SRGB8_ALPHA8_ASTC_4x4_KHR: GLenum;
    readonly COMPRESSED_SRGB8_ALPHA8_ASTC_5x4_KHR: GLenum;
    readonly COMPRESSED_SRGB8_ALPHA8_ASTC_5x5_KHR: GLenum;
    readonly COMPRESSED_SRGB8_ALPHA8_ASTC_6x5_KHR: GLenum;
    readonly COMPRESSED_SRGB8_ALPHA8_ASTC_6x6_KHR: GLenum;
    readonly COMPRESSED_SRGB8_ALPHA8_ASTC_8x5_KHR: GLenum;
    readonly COMPRESSED_SRGB8_ALPHA8_ASTC_8x6_KHR: GLenum;
    readonly COMPRESSED_SRGB8_ALPHA8_ASTC_8x8_KHR: GLenum;
    readonly COMPRESSED_SRGB8_ALPHA8_ASTC_10x5_KHR: GLenum;
    readonly COMPRESSED_SRGB8_ALPHA8_ASTC_10x6_KHR: GLenum;
    readonly COMPRESSED_SRGB8_ALPHA8_ASTC_10x8_KHR: GLenum;
    readonly COMPRESSED_SRGB8_ALPHA8_ASTC_10x10_KHR: GLenum;
    readonly COMPRESSED_SRGB8_ALPHA8_ASTC_12x10_KHR: GLenum;
    readonly COMPRESSED_SRGB8_ALPHA8_ASTC_12x12_KHR: GLenum;
  }
  /** WEBGL_depth_texture extension */
  interface WEBGL_depth_texture {
    /** 24/8 depth-stencil type */
    readonly UNSIGNED_INT_24_8_WEBGL: GLenum;
  }
  /** EXT_blend_minmax extension */
  interface EXT_blend_minmax {
    /** Blends by taking the minimum */
    readonly MIN_EXT: GLenum;
    /** Blends by taking the maximum */
    readonly MAX_EXT: GLenum;
  }
  /**
   * Extensions with no extra members (OES_texture_float, OES_texture_half_float_linear, OES_standard_derivatives, OES_element_index_uint;
   * in WebGL 2 OES_texture_float_linear, EXT_color_buffer_float, EXT_float_blend)
   */
  interface EmptyExtension {}

  /**
   * Maps extension names to extension objects of a WebGL 1 context (actual availability depends on the GL driver).
   * A WebGL 2 context exposes WebGL2ExtensionMap instead.
   */
  interface WebGLExtensionMap {
    /** Anisotropic filtering */
    EXT_texture_filter_anisotropic: EXT_texture_filter_anisotropic;
    /** Floating-point textures */
    OES_texture_float: EmptyExtension;
    /** Linear filtering of floating-point textures (mapped internally to OES_texture_float) */
    OES_texture_float_linear: EmptyExtension;
    /** Half-float textures */
    OES_texture_half_float: OES_texture_half_float;
    /** Linear filtering of half-float textures */
    OES_texture_half_float_linear: EmptyExtension;
    /** Shader derivatives */
    OES_standard_derivatives: EmptyExtension;
    /** Vertex array objects */
    OES_vertex_array_object: OES_vertex_array_object;
    /** Instanced drawing */
    ANGLE_instanced_arrays: ANGLE_instanced_arrays;
    /** 32-bit indices */
    OES_element_index_uint: EmptyExtension;
    /** PVRTC compressed textures */
    WEBGL_compressed_texture_pvrtc: WEBGL_compressed_texture_pvrtc;
    /** ASTC compressed textures */
    WEBGL_compressed_texture_astc: WEBGL_compressed_texture_astc;
    /** Depth textures */
    WEBGL_depth_texture: WEBGL_depth_texture;
    /** min/max blending */
    EXT_blend_minmax: EXT_blend_minmax;
  }

  /** WebGL 1 rendering context (WebGLRenderingContext), backed by OpenGL ES 2.0; see WebGL2RenderingContext for WebGL 2 */
  interface WebGLRenderingContext {
    /** The owning canvas */
    readonly canvas: Canvas | null;
    /** Drawing buffer width */
    readonly drawingBufferWidth: number;
    /** Drawing buffer height */
    readonly drawingBufferHeight: number;

    /** Gets the context attributes (fixed values) */
    getContextAttributes(): WebGLContextAttributes;
    /** Always returns false */
    isContextLost(): boolean;
    /** Gets the list of supported extension names */
    getSupportedExtensions(): string[];
    /** Gets an extension object, or null if it isn't supported */
    getExtension<K extends keyof WebGLExtensionMap>(name: K): WebGLExtensionMap[K] | null;
    /** Gets an extension object, or null if it isn't supported */
    getExtension(name: string): object | null;
    /** Activates a texture unit */
    activeTexture(texture: GLenum): void;
    /** Attaches a shader */
    attachShader(program: WebGLProgram, shader: WebGLShader): void;
    /** Binds an attribute location */
    bindAttribLocation(program: WebGLProgram, index: GLuint, name: string): void;
    /** Binds a buffer */
    bindBuffer(target: GLenum, buffer: WebGLBuffer | null): void;
    /** Binds a renderbuffer */
    bindRenderbuffer(target: GLenum, renderbuffer: WebGLRenderbuffer | null): void;
    /** Binds a framebuffer */
    bindFramebuffer(target: GLenum, framebuffer: WebGLFramebuffer | null): void;
    /** Binds canvas/image contents as a texture (non-standard) */
    wxBindCanvasTexture(target: GLenum, drawable: CanvasDrawable): void;
    /** Same as wxBindCanvasTexture (non-standard) */
    blBindCanvasTexture(target: GLenum, drawable: CanvasDrawable): void;
    /** Binds a texture */
    bindTexture(target: GLenum, texture: WebGLTexture | null): void;
    /** Blend color */
    blendColor(red: GLfloat, green: GLfloat, blue: GLfloat, alpha: GLfloat): void;
    /** Blend equation */
    blendEquation(mode: GLenum): void;
    /** Separate blend equations */
    blendEquationSeparate(modeRGB: GLenum, modeAlpha: GLenum): void;
    /** Blend factors */
    blendFunc(sfactor: GLenum, dfactor: GLenum): void;
    /** Separate blend factors */
    blendFuncSeparate(srcRGB: GLenum, dstRGB: GLenum, srcAlpha: GLenum, dstAlpha: GLenum): void;
    /** Allocates or uploads buffer data (a number means a size in bytes) */
    bufferData(target: GLenum, sizeOrData: number | ArrayBuffer | ArrayBufferView, usage: GLenum): void;
    /** Updates part of the buffer data */
    bufferSubData(target: GLenum, offset: GLintptr, data: ArrayBuffer | ArrayBufferView): void;
    /** Checks the framebuffer status */
    checkFramebufferStatus(target: GLenum): GLenum;
    /** Clears buffers */
    clear(mask: GLbitfield): void;
    /** Clear color */
    clearColor(red: GLfloat, green: GLfloat, blue: GLfloat, alpha: GLfloat): void;
    /** Clear depth */
    clearDepth(depth: GLfloat): void;
    /** Clear stencil value */
    clearStencil(s: GLint): void;
    /** Color write mask */
    colorMask(red: boolean, green: boolean, blue: boolean, alpha: boolean): void;
    /** Compiles a shader */
    compileShader(shader: WebGLShader): void;
    /** Uploads a compressed texture */
    compressedTexImage2D(target: GLenum, level: GLint, internalformat: GLenum, width: GLsizei, height: GLsizei, border: GLint, data: ArrayBufferView): void;
    /** Updates a compressed texture */
    compressedTexSubImage2D(target: GLenum, level: GLint, xoffset: GLint, yoffset: GLint, width: GLsizei, height: GLsizei, format: GLenum, data: ArrayBufferView): void;
    /** Copies a texture from the framebuffer (the border argument is ignored) */
    copyTexImage2D(target: GLenum, level: GLint, internalformat: GLenum, x: GLint, y: GLint, width: GLsizei, height: GLsizei, border?: GLint): void;
    /** Copies part of a texture from the framebuffer */
    copyTexSubImage2D(target: GLenum, level: GLint, xoffset: GLint, yoffset: GLint, x: GLint, y: GLint, width: GLsizei, height: GLsizei): void;
    /** Creates a buffer */
    createBuffer(): WebGLBuffer | null;
    /** Creates a framebuffer */
    createFramebuffer(): WebGLFramebuffer | null;
    /** Creates a renderbuffer */
    createRenderbuffer(): WebGLRenderbuffer | null;
    /** Creates a texture */
    createTexture(): WebGLTexture | null;
    /** Creates a program */
    createProgram(): WebGLProgram | null;
    /** Creates a shader */
    createShader(type: GLenum): WebGLShader | null;
    /** Face culling mode */
    cullFace(mode: GLenum): void;
    /** Deletes a buffer */
    deleteBuffer(buffer: WebGLBuffer | null): void;
    /** Deletes a framebuffer */
    deleteFramebuffer(framebuffer: WebGLFramebuffer | null): void;
    /** Deletes a renderbuffer */
    deleteRenderbuffer(renderbuffer: WebGLRenderbuffer | null): void;
    /** Deletes a shader */
    deleteShader(shader: WebGLShader | null): void;
    /** Deletes a texture */
    deleteTexture(texture: WebGLTexture | null): void;
    /** Deletes a program */
    deleteProgram(program: WebGLProgram | null): void;
    /** Depth comparison function */
    depthFunc(func: GLenum): void;
    /** Enables or disables depth writes */
    depthMask(flag: boolean): void;
    /** Depth range */
    depthRange(zNear: GLfloat, zFar: GLfloat): void;
    /** Detaches a shader */
    detachShader(program: WebGLProgram, shader: WebGLShader): void;
    /** Disables a capability */
    disable(cap: GLenum): void;
    /** Disables a vertex attribute array */
    disableVertexAttribArray(index: GLuint): void;
    /** Draws arrays */
    drawArrays(mode: GLenum, first: GLint, count: GLsizei): void;
    /** Draws elements */
    drawElements(mode: GLenum, count: GLsizei, type: GLenum, offset: GLintptr): void;
    /** Enables a capability */
    enable(cap: GLenum): void;
    /** Enables a vertex attribute array */
    enableVertexAttribArray(index: GLuint): void;
    /** Flushes commands */
    flush(): void;
    /** Waits for commands to finish */
    finish(): void;
    /** Attaches a renderbuffer to the framebuffer */
    framebufferRenderbuffer(target: GLenum, attachment: GLenum, renderbuffertarget: GLenum, renderbuffer: WebGLRenderbuffer | null): void;
    /** Attaches a texture to the framebuffer */
    framebufferTexture2D(target: GLenum, attachment: GLenum, textarget: GLenum, texture: WebGLTexture | null, level: GLint): void;
    /** Front face winding */
    frontFace(mode: GLenum): void;
    /** Generates mipmaps */
    generateMipmap(target: GLenum): void;
    /** Gets attribute information */
    getActiveAttrib(program: WebGLProgram, index: GLuint): WebGLActiveInfo | null;
    /** Gets uniform information */
    getActiveUniform(program: WebGLProgram, index: GLuint): WebGLActiveInfo | null;
    /** Gets the attached shaders */
    getAttachedShaders(program: WebGLProgram): WebGLShader[] | null;
    /** Gets an attribute location */
    getAttribLocation(program: WebGLProgram, name: string): GLint;
    /**
     * Queries a parameter: capabilities (BLEND, DEPTH_TEST, ...), DEPTH_WRITEMASK and the UNPACK_*_WEBGL flags are booleans,
     * VIEWPORT/SCISSOR_BOX/MAX_VIEWPORT_DIMS Int32Array, COLOR_WRITEMASK boolean[], bindings the object or null,
     * the texture unit limits at most 32, and other values numbers or strings
     */
    getParameter(pname: GLenum): any;
    /** Queries a buffer parameter */
    getBufferParameter(target: GLenum, pname: GLenum): any;
    /** Gets the error code */
    getError(): GLenum;
    /** Queries a framebuffer attachment parameter */
    getFramebufferAttachmentParameter(target: GLenum, attachment: GLenum, pname: GLenum): any;
    /** Queries a program parameter: DELETE_STATUS, LINK_STATUS and VALIDATE_STATUS are booleans, the rest numbers */
    getProgramParameter(program: WebGLProgram, pname: GLenum): any;
    /** Gets the program info log */
    getProgramInfoLog(program: WebGLProgram): string | null;
    /** Queries a renderbuffer parameter */
    getRenderbufferParameter(target: GLenum, pname: GLenum): any;
    /** Queries a shader parameter: DELETE_STATUS and COMPILE_STATUS are booleans, the rest numbers */
    getShaderParameter(shader: WebGLShader, pname: GLenum): any;
    /** Queries shader precision */
    getShaderPrecisionFormat(shadertype: GLenum, precisiontype: GLenum): WebGLShaderPrecisionFormat | null;
    /** Gets the shader info log */
    getShaderInfoLog(shader: WebGLShader): string | null;
    /** Gets the shader source */
    getShaderSource(shader: WebGLShader): string | null;
    /** Queries a parameter of the texture bound to target (null if none): TEXTURE_IMMUTABLE_FORMAT is a boolean, the rest numbers */
    getTexParameter(target: GLenum, pname: GLenum): any;
    /** Reads a uniform value */
    getUniform(program: WebGLProgram, location: WebGLUniformLocation): any;
    /** Gets a uniform location */
    getUniformLocation(program: WebGLProgram, name: string): WebGLUniformLocation | null;
    /** Queries a vertex attribute */
    getVertexAttrib(index: GLuint, pname: GLenum): any;
    /** Queries a vertex attribute offset */
    getVertexAttribOffset(index: GLuint, pname: GLenum): GLintptr;
    /** Hint */
    hint(target: GLenum, mode: GLenum): void;
    /** Returns whether the object is a buffer */
    isBuffer(buffer: WebGLBuffer | null): boolean;
    /** Returns whether the object is a framebuffer */
    isFramebuffer(framebuffer: WebGLFramebuffer | null): boolean;
    /** Returns whether the object is a program */
    isProgram(program: WebGLProgram | null): boolean;
    /** Returns whether the object is a renderbuffer */
    isRenderbuffer(renderbuffer: WebGLRenderbuffer | null): boolean;
    /** Returns whether the object is a shader */
    isShader(shader: WebGLShader | null): boolean;
    /** Returns whether the object is a texture */
    isTexture(texture: WebGLTexture | null): boolean;
    /** Returns whether a capability is enabled */
    isEnabled(cap: GLenum): boolean;
    /** Line width */
    lineWidth(width: GLfloat): void;
    /** Links a program */
    linkProgram(program: WebGLProgram): void;
    /** Pixel storage parameter */
    pixelStorei(pname: GLenum, param: GLint | boolean): void;
    /** Polygon offset */
    polygonOffset(factor: GLfloat, units: GLfloat): void;
    /** Reads pixels into pixels */
    readPixels(x: GLint, y: GLint, width: GLsizei, height: GLsizei, format: GLenum, type: GLenum, pixels: ArrayBufferView): void;
    /** Allocates renderbuffer storage */
    renderbufferStorage(target: GLenum, internalformat: GLenum, width: GLsizei, height: GLsizei): void;
    /** Multisample coverage */
    sampleCoverage(value: GLfloat, invert: boolean): void;
    /** Scissor rectangle */
    scissor(x: GLint, y: GLint, width: GLsizei, height: GLsizei): void;
    /** Sets the shader source */
    shaderSource(shader: WebGLShader, source: string): void;
    /** Stencil function */
    stencilFunc(func: GLenum, ref: GLint, mask: GLuint): void;
    /** Separate stencil functions */
    stencilFuncSeparate(face: GLenum, func: GLenum, ref: GLint, mask: GLuint): void;
    /** Stencil write mask */
    stencilMask(mask: GLuint): void;
    /** Separate stencil write masks */
    stencilMaskSeparate(face: GLenum, mask: GLuint): void;
    /** Stencil operation */
    stencilOp(fail: GLenum, zfail: GLenum, zpass: GLenum): void;
    /** Separate stencil operations */
    stencilOpSeparate(face: GLenum, fail: GLenum, zfail: GLenum, zpass: GLenum): void;
    /** Uploads a texture from a canvas, image or pixel data (6-argument form) */
    texImage2D(target: GLenum, level: GLint, internalformat: GLint, format: GLenum, type: GLenum, source: CanvasDrawable): void;
    /** Uploads a texture from a typed array (9-argument form) */
    texImage2D(target: GLenum, level: GLint, internalformat: GLint, width: GLsizei, height: GLsizei, border: GLint, format: GLenum, type: GLenum, pixels: ArrayBufferView | null): void;
    /** Updates a texture from a canvas, image or pixel data (7-argument form) */
    texSubImage2D(target: GLenum, level: GLint, xoffset: GLint, yoffset: GLint, format: GLenum, type: GLenum, source: CanvasDrawable): void;
    /** Updates a texture from a typed array (9-argument form) */
    texSubImage2D(target: GLenum, level: GLint, xoffset: GLint, yoffset: GLint, width: GLsizei, height: GLsizei, format: GLenum, type: GLenum, pixels: ArrayBufferView | null): void;
    /** Float texture parameter */
    texParameterf(target: GLenum, pname: GLenum, param: GLfloat): void;
    /** Integer texture parameter */
    texParameteri(target: GLenum, pname: GLenum, param: GLint): void;
    /** Sets a float uniform */
    uniform1f(location: WebGLUniformLocation | null, x: GLfloat): void;
    /** Sets a vec2 uniform */
    uniform2f(location: WebGLUniformLocation | null, x: GLfloat, y: GLfloat): void;
    /** Sets a vec3 uniform */
    uniform3f(location: WebGLUniformLocation | null, x: GLfloat, y: GLfloat, z: GLfloat): void;
    /** Sets a vec4 uniform */
    uniform4f(location: WebGLUniformLocation | null, x: GLfloat, y: GLfloat, z: GLfloat, w: GLfloat): void;
    /** Sets an int uniform */
    uniform1i(location: WebGLUniformLocation | null, x: GLint): void;
    /** Sets an ivec2 uniform */
    uniform2i(location: WebGLUniformLocation | null, x: GLint, y: GLint): void;
    /** Sets an ivec3 uniform */
    uniform3i(location: WebGLUniformLocation | null, x: GLint, y: GLint, z: GLint): void;
    /** Sets an ivec4 uniform */
    uniform4i(location: WebGLUniformLocation | null, x: GLint, y: GLint, z: GLint, w: GLint): void;
    /** Sets a float array uniform */
    uniform1fv(location: WebGLUniformLocation | null, v: Float32List): void;
    /** Sets a vec2 array uniform */
    uniform2fv(location: WebGLUniformLocation | null, v: Float32List): void;
    /** Sets a vec3 array uniform */
    uniform3fv(location: WebGLUniformLocation | null, v: Float32List): void;
    /** Sets a vec4 array uniform */
    uniform4fv(location: WebGLUniformLocation | null, v: Float32List): void;
    /** Sets an int array uniform */
    uniform1iv(location: WebGLUniformLocation | null, v: Int32List): void;
    /** Sets an ivec2 array uniform */
    uniform2iv(location: WebGLUniformLocation | null, v: Int32List): void;
    /** Sets an ivec3 array uniform */
    uniform3iv(location: WebGLUniformLocation | null, v: Int32List): void;
    /** Sets an ivec4 array uniform */
    uniform4iv(location: WebGLUniformLocation | null, v: Int32List): void;
    /** Sets a mat2 uniform */
    uniformMatrix2fv(location: WebGLUniformLocation | null, transpose: boolean, value: Float32List): void;
    /** Sets a mat3 uniform */
    uniformMatrix3fv(location: WebGLUniformLocation | null, transpose: boolean, value: Float32List): void;
    /** Sets a mat4 uniform */
    uniformMatrix4fv(location: WebGLUniformLocation | null, transpose: boolean, value: Float32List): void;
    /** Uses a program */
    useProgram(program: WebGLProgram | null): void;
    /** Validates a program */
    validateProgram(program: WebGLProgram): void;
    /** Sets a constant vertex attribute (1 component) */
    vertexAttrib1f(index: GLuint, x: GLfloat): void;
    /** Sets a constant vertex attribute (2 components) */
    vertexAttrib2f(index: GLuint, x: GLfloat, y: GLfloat): void;
    /** Sets a constant vertex attribute (3 components) */
    vertexAttrib3f(index: GLuint, x: GLfloat, y: GLfloat, z: GLfloat): void;
    /** Sets a constant vertex attribute (4 components) */
    vertexAttrib4f(index: GLuint, x: GLfloat, y: GLfloat, z: GLfloat, w: GLfloat): void;
    /** Sets a constant vertex attribute from an array (1 component) */
    vertexAttrib1fv(index: GLuint, values: Float32List): void;
    /** Sets a constant vertex attribute from an array (2 components) */
    vertexAttrib2fv(index: GLuint, values: Float32List): void;
    /** Sets a constant vertex attribute from an array (3 components) */
    vertexAttrib3fv(index: GLuint, values: Float32List): void;
    /** Sets a constant vertex attribute from an array (4 components) */
    vertexAttrib4fv(index: GLuint, values: Float32List): void;
    /** Vertex attribute pointer */
    vertexAttribPointer(index: GLuint, size: GLint, type: GLenum, normalized: boolean, stride: GLsizei, offset: GLintptr): void;
    /** Viewport */
    viewport(x: GLint, y: GLint, width: GLsizei, height: GLsizei): void;

    // ---- Constants (read-only numeric properties on the instance, named as in WebGL 1) ----
    /** Constant GL_DEPTH_BUFFER_BIT */
    readonly DEPTH_BUFFER_BIT: GLenum;
    /** Constant GL_STENCIL_BUFFER_BIT */
    readonly STENCIL_BUFFER_BIT: GLenum;
    /** Constant GL_COLOR_BUFFER_BIT */
    readonly COLOR_BUFFER_BIT: GLenum;
    /** Constant GL_FALSE */
    readonly FALSE: GLenum;
    /** Constant GL_TRUE */
    readonly TRUE: GLenum;
    /** Constant GL_POINTS */
    readonly POINTS: GLenum;
    /** Constant GL_LINES */
    readonly LINES: GLenum;
    /** Constant GL_LINE_LOOP */
    readonly LINE_LOOP: GLenum;
    /** Constant GL_LINE_STRIP */
    readonly LINE_STRIP: GLenum;
    /** Constant GL_TRIANGLES */
    readonly TRIANGLES: GLenum;
    /** Constant GL_TRIANGLE_STRIP */
    readonly TRIANGLE_STRIP: GLenum;
    /** Constant GL_TRIANGLE_FAN */
    readonly TRIANGLE_FAN: GLenum;
    /** Constant GL_ZERO */
    readonly ZERO: GLenum;
    /** Constant GL_ONE */
    readonly ONE: GLenum;
    /** Constant GL_SRC_COLOR */
    readonly SRC_COLOR: GLenum;
    /** Constant GL_ONE_MINUS_SRC_COLOR */
    readonly ONE_MINUS_SRC_COLOR: GLenum;
    /** Constant GL_SRC_ALPHA */
    readonly SRC_ALPHA: GLenum;
    /** Constant GL_ONE_MINUS_SRC_ALPHA */
    readonly ONE_MINUS_SRC_ALPHA: GLenum;
    /** Constant GL_DST_ALPHA */
    readonly DST_ALPHA: GLenum;
    /** Constant GL_ONE_MINUS_DST_ALPHA */
    readonly ONE_MINUS_DST_ALPHA: GLenum;
    /** Constant GL_DST_COLOR */
    readonly DST_COLOR: GLenum;
    /** Constant GL_ONE_MINUS_DST_COLOR */
    readonly ONE_MINUS_DST_COLOR: GLenum;
    /** Constant GL_SRC_ALPHA_SATURATE */
    readonly SRC_ALPHA_SATURATE: GLenum;
    /** Constant GL_FUNC_ADD */
    readonly FUNC_ADD: GLenum;
    /** Constant GL_BLEND_EQUATION */
    readonly BLEND_EQUATION: GLenum;
    /** Constant GL_BLEND_EQUATION_RGB */
    readonly BLEND_EQUATION_RGB: GLenum;
    /** Constant GL_BLEND_EQUATION_ALPHA */
    readonly BLEND_EQUATION_ALPHA: GLenum;
    /** Constant GL_FUNC_SUBTRACT */
    readonly FUNC_SUBTRACT: GLenum;
    /** Constant GL_FUNC_REVERSE_SUBTRACT */
    readonly FUNC_REVERSE_SUBTRACT: GLenum;
    /** Constant GL_BLEND_DST_RGB */
    readonly BLEND_DST_RGB: GLenum;
    /** Constant GL_BLEND_SRC_RGB */
    readonly BLEND_SRC_RGB: GLenum;
    /** Constant GL_BLEND_DST_ALPHA */
    readonly BLEND_DST_ALPHA: GLenum;
    /** Constant GL_BLEND_SRC_ALPHA */
    readonly BLEND_SRC_ALPHA: GLenum;
    /** Constant GL_CONSTANT_COLOR */
    readonly CONSTANT_COLOR: GLenum;
    /** Constant GL_ONE_MINUS_CONSTANT_COLOR */
    readonly ONE_MINUS_CONSTANT_COLOR: GLenum;
    /** Constant GL_CONSTANT_ALPHA */
    readonly CONSTANT_ALPHA: GLenum;
    /** Constant GL_ONE_MINUS_CONSTANT_ALPHA */
    readonly ONE_MINUS_CONSTANT_ALPHA: GLenum;
    /** Constant GL_BLEND_COLOR */
    readonly BLEND_COLOR: GLenum;
    /** Constant GL_ARRAY_BUFFER */
    readonly ARRAY_BUFFER: GLenum;
    /** Constant GL_ELEMENT_ARRAY_BUFFER */
    readonly ELEMENT_ARRAY_BUFFER: GLenum;
    /** Constant GL_ARRAY_BUFFER_BINDING */
    readonly ARRAY_BUFFER_BINDING: GLenum;
    /** Constant GL_ELEMENT_ARRAY_BUFFER_BINDING */
    readonly ELEMENT_ARRAY_BUFFER_BINDING: GLenum;
    /** Constant GL_STREAM_DRAW */
    readonly STREAM_DRAW: GLenum;
    /** Constant GL_STATIC_DRAW */
    readonly STATIC_DRAW: GLenum;
    /** Constant GL_DYNAMIC_DRAW */
    readonly DYNAMIC_DRAW: GLenum;
    /** Constant GL_BUFFER_SIZE */
    readonly BUFFER_SIZE: GLenum;
    /** Constant GL_BUFFER_USAGE */
    readonly BUFFER_USAGE: GLenum;
    /** Constant GL_CURRENT_VERTEX_ATTRIB */
    readonly CURRENT_VERTEX_ATTRIB: GLenum;
    /** Constant GL_FRONT */
    readonly FRONT: GLenum;
    /** Constant GL_BACK */
    readonly BACK: GLenum;
    /** Constant GL_FRONT_AND_BACK */
    readonly FRONT_AND_BACK: GLenum;
    /** Constant GL_TEXTURE_2D */
    readonly TEXTURE_2D: GLenum;
    /** Constant GL_CULL_FACE */
    readonly CULL_FACE: GLenum;
    /** Constant GL_BLEND */
    readonly BLEND: GLenum;
    /** Constant GL_DITHER */
    readonly DITHER: GLenum;
    /** Constant GL_STENCIL_TEST */
    readonly STENCIL_TEST: GLenum;
    /** Constant GL_DEPTH_TEST */
    readonly DEPTH_TEST: GLenum;
    /** Constant GL_SCISSOR_TEST */
    readonly SCISSOR_TEST: GLenum;
    /** Constant GL_POLYGON_OFFSET_FILL */
    readonly POLYGON_OFFSET_FILL: GLenum;
    /** Constant GL_SAMPLE_ALPHA_TO_COVERAGE */
    readonly SAMPLE_ALPHA_TO_COVERAGE: GLenum;
    /** Constant GL_SAMPLE_COVERAGE */
    readonly SAMPLE_COVERAGE: GLenum;
    /** Constant GL_NO_ERROR */
    readonly NO_ERROR: GLenum;
    /** Constant GL_INVALID_ENUM */
    readonly INVALID_ENUM: GLenum;
    /** Constant GL_INVALID_VALUE */
    readonly INVALID_VALUE: GLenum;
    /** Constant GL_INVALID_OPERATION */
    readonly INVALID_OPERATION: GLenum;
    /** Constant GL_OUT_OF_MEMORY */
    readonly OUT_OF_MEMORY: GLenum;
    /** Constant GL_CW */
    readonly CW: GLenum;
    /** Constant GL_CCW */
    readonly CCW: GLenum;
    /** Constant GL_LINE_WIDTH */
    readonly LINE_WIDTH: GLenum;
    /** Constant GL_ALIASED_POINT_SIZE_RANGE */
    readonly ALIASED_POINT_SIZE_RANGE: GLenum;
    /** Constant GL_ALIASED_LINE_WIDTH_RANGE */
    readonly ALIASED_LINE_WIDTH_RANGE: GLenum;
    /** Constant GL_CULL_FACE_MODE */
    readonly CULL_FACE_MODE: GLenum;
    /** Constant GL_FRONT_FACE */
    readonly FRONT_FACE: GLenum;
    /** Constant GL_DEPTH_RANGE */
    readonly DEPTH_RANGE: GLenum;
    /** Constant GL_DEPTH_WRITEMASK */
    readonly DEPTH_WRITEMASK: GLenum;
    /** Constant GL_DEPTH_CLEAR_VALUE */
    readonly DEPTH_CLEAR_VALUE: GLenum;
    /** Constant GL_DEPTH_FUNC */
    readonly DEPTH_FUNC: GLenum;
    /** Constant GL_STENCIL_CLEAR_VALUE */
    readonly STENCIL_CLEAR_VALUE: GLenum;
    /** Constant GL_STENCIL_FUNC */
    readonly STENCIL_FUNC: GLenum;
    /** Constant GL_STENCIL_FAIL */
    readonly STENCIL_FAIL: GLenum;
    /** Constant GL_STENCIL_PASS_DEPTH_FAIL */
    readonly STENCIL_PASS_DEPTH_FAIL: GLenum;
    /** Constant GL_STENCIL_PASS_DEPTH_PASS */
    readonly STENCIL_PASS_DEPTH_PASS: GLenum;
    /** Constant GL_STENCIL_REF */
    readonly STENCIL_REF: GLenum;
    /** Constant GL_STENCIL_VALUE_MASK */
    readonly STENCIL_VALUE_MASK: GLenum;
    /** Constant GL_STENCIL_WRITEMASK */
    readonly STENCIL_WRITEMASK: GLenum;
    /** Constant GL_STENCIL_BACK_FUNC */
    readonly STENCIL_BACK_FUNC: GLenum;
    /** Constant GL_STENCIL_BACK_FAIL */
    readonly STENCIL_BACK_FAIL: GLenum;
    /** Constant GL_STENCIL_BACK_PASS_DEPTH_FAIL */
    readonly STENCIL_BACK_PASS_DEPTH_FAIL: GLenum;
    /** Constant GL_STENCIL_BACK_PASS_DEPTH_PASS */
    readonly STENCIL_BACK_PASS_DEPTH_PASS: GLenum;
    /** Constant GL_STENCIL_BACK_REF */
    readonly STENCIL_BACK_REF: GLenum;
    /** Constant GL_STENCIL_BACK_VALUE_MASK */
    readonly STENCIL_BACK_VALUE_MASK: GLenum;
    /** Constant GL_STENCIL_BACK_WRITEMASK */
    readonly STENCIL_BACK_WRITEMASK: GLenum;
    /** Constant GL_VIEWPORT */
    readonly VIEWPORT: GLenum;
    /** Constant GL_SCISSOR_BOX */
    readonly SCISSOR_BOX: GLenum;
    /** Constant GL_COLOR_CLEAR_VALUE */
    readonly COLOR_CLEAR_VALUE: GLenum;
    /** Constant GL_COLOR_WRITEMASK */
    readonly COLOR_WRITEMASK: GLenum;
    /** Constant GL_UNPACK_ALIGNMENT */
    readonly UNPACK_ALIGNMENT: GLenum;
    /** Constant GL_PACK_ALIGNMENT */
    readonly PACK_ALIGNMENT: GLenum;
    /** Constant GL_MAX_TEXTURE_SIZE */
    readonly MAX_TEXTURE_SIZE: GLenum;
    /** Constant GL_MAX_VIEWPORT_DIMS */
    readonly MAX_VIEWPORT_DIMS: GLenum;
    /** Constant GL_SUBPIXEL_BITS */
    readonly SUBPIXEL_BITS: GLenum;
    /** Constant GL_RED_BITS */
    readonly RED_BITS: GLenum;
    /** Constant GL_GREEN_BITS */
    readonly GREEN_BITS: GLenum;
    /** Constant GL_BLUE_BITS */
    readonly BLUE_BITS: GLenum;
    /** Constant GL_ALPHA_BITS */
    readonly ALPHA_BITS: GLenum;
    /** Constant GL_DEPTH_BITS */
    readonly DEPTH_BITS: GLenum;
    /** Constant GL_STENCIL_BITS */
    readonly STENCIL_BITS: GLenum;
    /** Constant GL_POLYGON_OFFSET_UNITS */
    readonly POLYGON_OFFSET_UNITS: GLenum;
    /** Constant GL_POLYGON_OFFSET_FACTOR */
    readonly POLYGON_OFFSET_FACTOR: GLenum;
    /** Constant GL_TEXTURE_BINDING_2D */
    readonly TEXTURE_BINDING_2D: GLenum;
    /** Constant GL_SAMPLE_BUFFERS */
    readonly SAMPLE_BUFFERS: GLenum;
    /** Constant GL_SAMPLES */
    readonly SAMPLES: GLenum;
    /** Constant GL_SAMPLE_COVERAGE_VALUE */
    readonly SAMPLE_COVERAGE_VALUE: GLenum;
    /** Constant GL_SAMPLE_COVERAGE_INVERT */
    readonly SAMPLE_COVERAGE_INVERT: GLenum;
    /** Constant GL_NUM_COMPRESSED_TEXTURE_FORMATS */
    readonly NUM_COMPRESSED_TEXTURE_FORMATS: GLenum;
    /** Constant GL_COMPRESSED_TEXTURE_FORMATS */
    readonly COMPRESSED_TEXTURE_FORMATS: GLenum;
    /** Constant GL_DONT_CARE */
    readonly DONT_CARE: GLenum;
    /** Constant GL_FASTEST */
    readonly FASTEST: GLenum;
    /** Constant GL_NICEST */
    readonly NICEST: GLenum;
    /** Constant GL_GENERATE_MIPMAP_HINT */
    readonly GENERATE_MIPMAP_HINT: GLenum;
    /** Constant GL_BYTE */
    readonly BYTE: GLenum;
    /** Constant GL_UNSIGNED_BYTE */
    readonly UNSIGNED_BYTE: GLenum;
    /** Constant GL_SHORT */
    readonly SHORT: GLenum;
    /** Constant GL_UNSIGNED_SHORT */
    readonly UNSIGNED_SHORT: GLenum;
    /** Constant GL_INT */
    readonly INT: GLenum;
    /** Constant GL_UNSIGNED_INT */
    readonly UNSIGNED_INT: GLenum;
    /** Constant GL_FLOAT */
    readonly FLOAT: GLenum;
    /** Constant GL_FIXED */
    readonly FIXED: GLenum;
    /** Constant GL_DEPTH_COMPONENT */
    readonly DEPTH_COMPONENT: GLenum;
    /** Constant GL_ALPHA */
    readonly ALPHA: GLenum;
    /** Constant GL_RGB */
    readonly RGB: GLenum;
    /** Constant GL_RGBA */
    readonly RGBA: GLenum;
    /** Constant GL_LUMINANCE */
    readonly LUMINANCE: GLenum;
    /** Constant GL_LUMINANCE_ALPHA */
    readonly LUMINANCE_ALPHA: GLenum;
    /** Constant GL_UNSIGNED_SHORT_4_4_4_4 */
    readonly UNSIGNED_SHORT_4_4_4_4: GLenum;
    /** Constant GL_UNSIGNED_SHORT_5_5_5_1 */
    readonly UNSIGNED_SHORT_5_5_5_1: GLenum;
    /** Constant GL_UNSIGNED_SHORT_5_6_5 */
    readonly UNSIGNED_SHORT_5_6_5: GLenum;
    /** Constant GL_FRAGMENT_SHADER */
    readonly FRAGMENT_SHADER: GLenum;
    /** Constant GL_VERTEX_SHADER */
    readonly VERTEX_SHADER: GLenum;
    /** Constant GL_MAX_VERTEX_ATTRIBS */
    readonly MAX_VERTEX_ATTRIBS: GLenum;
    /** Constant GL_MAX_VERTEX_UNIFORM_VECTORS */
    readonly MAX_VERTEX_UNIFORM_VECTORS: GLenum;
    /** Constant GL_MAX_VARYING_VECTORS */
    readonly MAX_VARYING_VECTORS: GLenum;
    /** Constant GL_MAX_COMBINED_TEXTURE_IMAGE_UNITS */
    readonly MAX_COMBINED_TEXTURE_IMAGE_UNITS: GLenum;
    /** Constant GL_MAX_VERTEX_TEXTURE_IMAGE_UNITS */
    readonly MAX_VERTEX_TEXTURE_IMAGE_UNITS: GLenum;
    /** Constant GL_MAX_TEXTURE_IMAGE_UNITS */
    readonly MAX_TEXTURE_IMAGE_UNITS: GLenum;
    /** Constant GL_MAX_FRAGMENT_UNIFORM_VECTORS */
    readonly MAX_FRAGMENT_UNIFORM_VECTORS: GLenum;
    /** Constant GL_SHADER_TYPE */
    readonly SHADER_TYPE: GLenum;
    /** Constant GL_DELETE_STATUS */
    readonly DELETE_STATUS: GLenum;
    /** Constant GL_LINK_STATUS */
    readonly LINK_STATUS: GLenum;
    /** Constant GL_VALIDATE_STATUS */
    readonly VALIDATE_STATUS: GLenum;
    /** Constant GL_ATTACHED_SHADERS */
    readonly ATTACHED_SHADERS: GLenum;
    /** Constant GL_ACTIVE_UNIFORMS */
    readonly ACTIVE_UNIFORMS: GLenum;
    /** Constant GL_ACTIVE_UNIFORM_MAX_LENGTH */
    readonly ACTIVE_UNIFORM_MAX_LENGTH: GLenum;
    /** Constant GL_ACTIVE_ATTRIBUTES */
    readonly ACTIVE_ATTRIBUTES: GLenum;
    /** Constant GL_ACTIVE_ATTRIBUTE_MAX_LENGTH */
    readonly ACTIVE_ATTRIBUTE_MAX_LENGTH: GLenum;
    /** Constant GL_SHADING_LANGUAGE_VERSION */
    readonly SHADING_LANGUAGE_VERSION: GLenum;
    /** Constant GL_CURRENT_PROGRAM */
    readonly CURRENT_PROGRAM: GLenum;
    /** Constant GL_NEVER */
    readonly NEVER: GLenum;
    /** Constant GL_LESS */
    readonly LESS: GLenum;
    /** Constant GL_EQUAL */
    readonly EQUAL: GLenum;
    /** Constant GL_LEQUAL */
    readonly LEQUAL: GLenum;
    /** Constant GL_GREATER */
    readonly GREATER: GLenum;
    /** Constant GL_NOTEQUAL */
    readonly NOTEQUAL: GLenum;
    /** Constant GL_GEQUAL */
    readonly GEQUAL: GLenum;
    /** Constant GL_ALWAYS */
    readonly ALWAYS: GLenum;
    /** Constant GL_KEEP */
    readonly KEEP: GLenum;
    /** Constant GL_REPLACE */
    readonly REPLACE: GLenum;
    /** Constant GL_INCR */
    readonly INCR: GLenum;
    /** Constant GL_DECR */
    readonly DECR: GLenum;
    /** Constant GL_INVERT */
    readonly INVERT: GLenum;
    /** Constant GL_INCR_WRAP */
    readonly INCR_WRAP: GLenum;
    /** Constant GL_DECR_WRAP */
    readonly DECR_WRAP: GLenum;
    /** Constant GL_VENDOR */
    readonly VENDOR: GLenum;
    /** Constant GL_RENDERER */
    readonly RENDERER: GLenum;
    /** Constant GL_VERSION */
    readonly VERSION: GLenum;
    /** Constant GL_EXTENSIONS */
    readonly EXTENSIONS: GLenum;
    /** Constant GL_NEAREST */
    readonly NEAREST: GLenum;
    /** Constant GL_LINEAR */
    readonly LINEAR: GLenum;
    /** Constant GL_NEAREST_MIPMAP_NEAREST */
    readonly NEAREST_MIPMAP_NEAREST: GLenum;
    /** Constant GL_LINEAR_MIPMAP_NEAREST */
    readonly LINEAR_MIPMAP_NEAREST: GLenum;
    /** Constant GL_NEAREST_MIPMAP_LINEAR */
    readonly NEAREST_MIPMAP_LINEAR: GLenum;
    /** Constant GL_LINEAR_MIPMAP_LINEAR */
    readonly LINEAR_MIPMAP_LINEAR: GLenum;
    /** Constant GL_TEXTURE_MAG_FILTER */
    readonly TEXTURE_MAG_FILTER: GLenum;
    /** Constant GL_TEXTURE_MIN_FILTER */
    readonly TEXTURE_MIN_FILTER: GLenum;
    /** Constant GL_TEXTURE_WRAP_S */
    readonly TEXTURE_WRAP_S: GLenum;
    /** Constant GL_TEXTURE_WRAP_T */
    readonly TEXTURE_WRAP_T: GLenum;
    /** Constant GL_TEXTURE */
    readonly TEXTURE: GLenum;
    /** Constant GL_TEXTURE_CUBE_MAP */
    readonly TEXTURE_CUBE_MAP: GLenum;
    /** Constant GL_TEXTURE_BINDING_CUBE_MAP */
    readonly TEXTURE_BINDING_CUBE_MAP: GLenum;
    /** Constant GL_TEXTURE_CUBE_MAP_POSITIVE_X */
    readonly TEXTURE_CUBE_MAP_POSITIVE_X: GLenum;
    /** Constant GL_TEXTURE_CUBE_MAP_NEGATIVE_X */
    readonly TEXTURE_CUBE_MAP_NEGATIVE_X: GLenum;
    /** Constant GL_TEXTURE_CUBE_MAP_POSITIVE_Y */
    readonly TEXTURE_CUBE_MAP_POSITIVE_Y: GLenum;
    /** Constant GL_TEXTURE_CUBE_MAP_NEGATIVE_Y */
    readonly TEXTURE_CUBE_MAP_NEGATIVE_Y: GLenum;
    /** Constant GL_TEXTURE_CUBE_MAP_POSITIVE_Z */
    readonly TEXTURE_CUBE_MAP_POSITIVE_Z: GLenum;
    /** Constant GL_TEXTURE_CUBE_MAP_NEGATIVE_Z */
    readonly TEXTURE_CUBE_MAP_NEGATIVE_Z: GLenum;
    /** Constant GL_MAX_CUBE_MAP_TEXTURE_SIZE */
    readonly MAX_CUBE_MAP_TEXTURE_SIZE: GLenum;
    /** Constant GL_TEXTURE0 */
    readonly TEXTURE0: GLenum;
    /** Constant GL_TEXTURE1 */
    readonly TEXTURE1: GLenum;
    /** Constant GL_TEXTURE2 */
    readonly TEXTURE2: GLenum;
    /** Constant GL_TEXTURE3 */
    readonly TEXTURE3: GLenum;
    /** Constant GL_TEXTURE4 */
    readonly TEXTURE4: GLenum;
    /** Constant GL_TEXTURE5 */
    readonly TEXTURE5: GLenum;
    /** Constant GL_TEXTURE6 */
    readonly TEXTURE6: GLenum;
    /** Constant GL_TEXTURE7 */
    readonly TEXTURE7: GLenum;
    /** Constant GL_TEXTURE8 */
    readonly TEXTURE8: GLenum;
    /** Constant GL_TEXTURE9 */
    readonly TEXTURE9: GLenum;
    /** Constant GL_TEXTURE10 */
    readonly TEXTURE10: GLenum;
    /** Constant GL_TEXTURE11 */
    readonly TEXTURE11: GLenum;
    /** Constant GL_TEXTURE12 */
    readonly TEXTURE12: GLenum;
    /** Constant GL_TEXTURE13 */
    readonly TEXTURE13: GLenum;
    /** Constant GL_TEXTURE14 */
    readonly TEXTURE14: GLenum;
    /** Constant GL_TEXTURE15 */
    readonly TEXTURE15: GLenum;
    /** Constant GL_TEXTURE16 */
    readonly TEXTURE16: GLenum;
    /** Constant GL_TEXTURE17 */
    readonly TEXTURE17: GLenum;
    /** Constant GL_TEXTURE18 */
    readonly TEXTURE18: GLenum;
    /** Constant GL_TEXTURE19 */
    readonly TEXTURE19: GLenum;
    /** Constant GL_TEXTURE20 */
    readonly TEXTURE20: GLenum;
    /** Constant GL_TEXTURE21 */
    readonly TEXTURE21: GLenum;
    /** Constant GL_TEXTURE22 */
    readonly TEXTURE22: GLenum;
    /** Constant GL_TEXTURE23 */
    readonly TEXTURE23: GLenum;
    /** Constant GL_TEXTURE24 */
    readonly TEXTURE24: GLenum;
    /** Constant GL_TEXTURE25 */
    readonly TEXTURE25: GLenum;
    /** Constant GL_TEXTURE26 */
    readonly TEXTURE26: GLenum;
    /** Constant GL_TEXTURE27 */
    readonly TEXTURE27: GLenum;
    /** Constant GL_TEXTURE28 */
    readonly TEXTURE28: GLenum;
    /** Constant GL_TEXTURE29 */
    readonly TEXTURE29: GLenum;
    /** Constant GL_TEXTURE30 */
    readonly TEXTURE30: GLenum;
    /** Constant GL_TEXTURE31 */
    readonly TEXTURE31: GLenum;
    /** Constant GL_ACTIVE_TEXTURE */
    readonly ACTIVE_TEXTURE: GLenum;
    /** Constant GL_REPEAT */
    readonly REPEAT: GLenum;
    /** Constant GL_CLAMP_TO_EDGE */
    readonly CLAMP_TO_EDGE: GLenum;
    /** Constant GL_MIRRORED_REPEAT */
    readonly MIRRORED_REPEAT: GLenum;
    /** Constant GL_FLOAT_VEC2 */
    readonly FLOAT_VEC2: GLenum;
    /** Constant GL_FLOAT_VEC3 */
    readonly FLOAT_VEC3: GLenum;
    /** Constant GL_FLOAT_VEC4 */
    readonly FLOAT_VEC4: GLenum;
    /** Constant GL_INT_VEC2 */
    readonly INT_VEC2: GLenum;
    /** Constant GL_INT_VEC3 */
    readonly INT_VEC3: GLenum;
    /** Constant GL_INT_VEC4 */
    readonly INT_VEC4: GLenum;
    /** Constant GL_BOOL */
    readonly BOOL: GLenum;
    /** Constant GL_BOOL_VEC2 */
    readonly BOOL_VEC2: GLenum;
    /** Constant GL_BOOL_VEC3 */
    readonly BOOL_VEC3: GLenum;
    /** Constant GL_BOOL_VEC4 */
    readonly BOOL_VEC4: GLenum;
    /** Constant GL_FLOAT_MAT2 */
    readonly FLOAT_MAT2: GLenum;
    /** Constant GL_FLOAT_MAT3 */
    readonly FLOAT_MAT3: GLenum;
    /** Constant GL_FLOAT_MAT4 */
    readonly FLOAT_MAT4: GLenum;
    /** Constant GL_SAMPLER_2D */
    readonly SAMPLER_2D: GLenum;
    /** Constant GL_SAMPLER_CUBE */
    readonly SAMPLER_CUBE: GLenum;
    /** Constant GL_VERTEX_ATTRIB_ARRAY_ENABLED */
    readonly VERTEX_ATTRIB_ARRAY_ENABLED: GLenum;
    /** Constant GL_VERTEX_ATTRIB_ARRAY_SIZE */
    readonly VERTEX_ATTRIB_ARRAY_SIZE: GLenum;
    /** Constant GL_VERTEX_ATTRIB_ARRAY_STRIDE */
    readonly VERTEX_ATTRIB_ARRAY_STRIDE: GLenum;
    /** Constant GL_VERTEX_ATTRIB_ARRAY_TYPE */
    readonly VERTEX_ATTRIB_ARRAY_TYPE: GLenum;
    /** Constant GL_VERTEX_ATTRIB_ARRAY_NORMALIZED */
    readonly VERTEX_ATTRIB_ARRAY_NORMALIZED: GLenum;
    /** Constant GL_VERTEX_ATTRIB_ARRAY_POINTER */
    readonly VERTEX_ATTRIB_ARRAY_POINTER: GLenum;
    /** Constant GL_VERTEX_ATTRIB_ARRAY_BUFFER_BINDING */
    readonly VERTEX_ATTRIB_ARRAY_BUFFER_BINDING: GLenum;
    /** Constant GL_IMPLEMENTATION_COLOR_READ_TYPE */
    readonly IMPLEMENTATION_COLOR_READ_TYPE: GLenum;
    /** Constant GL_IMPLEMENTATION_COLOR_READ_FORMAT */
    readonly IMPLEMENTATION_COLOR_READ_FORMAT: GLenum;
    /** Constant GL_COMPILE_STATUS */
    readonly COMPILE_STATUS: GLenum;
    /** Constant GL_INFO_LOG_LENGTH */
    readonly INFO_LOG_LENGTH: GLenum;
    /** Constant GL_SHADER_SOURCE_LENGTH */
    readonly SHADER_SOURCE_LENGTH: GLenum;
    /** Constant GL_SHADER_COMPILER */
    readonly SHADER_COMPILER: GLenum;
    /** Constant GL_SHADER_BINARY_FORMATS */
    readonly SHADER_BINARY_FORMATS: GLenum;
    /** Constant GL_NUM_SHADER_BINARY_FORMATS */
    readonly NUM_SHADER_BINARY_FORMATS: GLenum;
    /** Constant GL_LOW_FLOAT */
    readonly LOW_FLOAT: GLenum;
    /** Constant GL_MEDIUM_FLOAT */
    readonly MEDIUM_FLOAT: GLenum;
    /** Constant GL_HIGH_FLOAT */
    readonly HIGH_FLOAT: GLenum;
    /** Constant GL_LOW_INT */
    readonly LOW_INT: GLenum;
    /** Constant GL_MEDIUM_INT */
    readonly MEDIUM_INT: GLenum;
    /** Constant GL_HIGH_INT */
    readonly HIGH_INT: GLenum;
    /** Constant GL_FRAMEBUFFER */
    readonly FRAMEBUFFER: GLenum;
    /** Constant GL_RENDERBUFFER */
    readonly RENDERBUFFER: GLenum;
    /** Constant GL_RGBA4 */
    readonly RGBA4: GLenum;
    /** Constant GL_RGB5_A1 */
    readonly RGB5_A1: GLenum;
    /** Constant GL_RGB565 */
    readonly RGB565: GLenum;
    /** Constant GL_DEPTH_COMPONENT16 */
    readonly DEPTH_COMPONENT16: GLenum;
    /** Constant STENCIL_INDEX (its actual value is GL_DEPTH_STENCIL_OES) */
    readonly STENCIL_INDEX: GLenum;
    /** Constant STENCIL_INDEX8 (its actual value is GL_DEPTH_STENCIL_OES) */
    readonly STENCIL_INDEX8: GLenum;
    /** Constant DEPTH_STENCIL (its actual value is GL_DEPTH_STENCIL_OES) */
    readonly DEPTH_STENCIL: GLenum;
    /** Constant GL_RENDERBUFFER_WIDTH */
    readonly RENDERBUFFER_WIDTH: GLenum;
    /** Constant GL_RENDERBUFFER_HEIGHT */
    readonly RENDERBUFFER_HEIGHT: GLenum;
    /** Constant GL_RENDERBUFFER_INTERNAL_FORMAT */
    readonly RENDERBUFFER_INTERNAL_FORMAT: GLenum;
    /** Constant GL_RENDERBUFFER_RED_SIZE */
    readonly RENDERBUFFER_RED_SIZE: GLenum;
    /** Constant GL_RENDERBUFFER_GREEN_SIZE */
    readonly RENDERBUFFER_GREEN_SIZE: GLenum;
    /** Constant GL_RENDERBUFFER_BLUE_SIZE */
    readonly RENDERBUFFER_BLUE_SIZE: GLenum;
    /** Constant GL_RENDERBUFFER_ALPHA_SIZE */
    readonly RENDERBUFFER_ALPHA_SIZE: GLenum;
    /** Constant GL_RENDERBUFFER_DEPTH_SIZE */
    readonly RENDERBUFFER_DEPTH_SIZE: GLenum;
    /** Constant GL_RENDERBUFFER_STENCIL_SIZE */
    readonly RENDERBUFFER_STENCIL_SIZE: GLenum;
    /** Constant GL_FRAMEBUFFER_ATTACHMENT_OBJECT_TYPE */
    readonly FRAMEBUFFER_ATTACHMENT_OBJECT_TYPE: GLenum;
    /** Constant GL_FRAMEBUFFER_ATTACHMENT_OBJECT_NAME */
    readonly FRAMEBUFFER_ATTACHMENT_OBJECT_NAME: GLenum;
    /** Constant GL_FRAMEBUFFER_ATTACHMENT_TEXTURE_LEVEL */
    readonly FRAMEBUFFER_ATTACHMENT_TEXTURE_LEVEL: GLenum;
    /** Constant GL_FRAMEBUFFER_ATTACHMENT_TEXTURE_CUBE_MAP_FACE */
    readonly FRAMEBUFFER_ATTACHMENT_TEXTURE_CUBE_MAP_FACE: GLenum;
    /** Constant GL_COLOR_ATTACHMENT0 */
    readonly COLOR_ATTACHMENT0: GLenum;
    /** Constant GL_DEPTH_ATTACHMENT */
    readonly DEPTH_ATTACHMENT: GLenum;
    /** Constant GL_STENCIL_ATTACHMENT */
    readonly STENCIL_ATTACHMENT: GLenum;
    /** Constant GL_DEPTH_STENCIL_ATTACHMENT */
    readonly DEPTH_STENCIL_ATTACHMENT: GLenum;
    /** Constant GL_NONE */
    readonly NONE: GLenum;
    /** Constant GL_FRAMEBUFFER_COMPLETE */
    readonly FRAMEBUFFER_COMPLETE: GLenum;
    /** Constant GL_FRAMEBUFFER_INCOMPLETE_ATTACHMENT */
    readonly FRAMEBUFFER_INCOMPLETE_ATTACHMENT: GLenum;
    /** Constant GL_FRAMEBUFFER_INCOMPLETE_MISSING_ATTACHMENT */
    readonly FRAMEBUFFER_INCOMPLETE_MISSING_ATTACHMENT: GLenum;
    /** Constant GL_FRAMEBUFFER_INCOMPLETE_DIMENSIONS */
    readonly FRAMEBUFFER_INCOMPLETE_DIMENSIONS: GLenum;
    /** Constant GL_FRAMEBUFFER_UNSUPPORTED */
    readonly FRAMEBUFFER_UNSUPPORTED: GLenum;
    /** Constant GL_FRAMEBUFFER_BINDING */
    readonly FRAMEBUFFER_BINDING: GLenum;
    /** Constant GL_RENDERBUFFER_BINDING */
    readonly RENDERBUFFER_BINDING: GLenum;
    /** Constant GL_MAX_RENDERBUFFER_SIZE */
    readonly MAX_RENDERBUFFER_SIZE: GLenum;
    /** Constant GL_INVALID_FRAMEBUFFER_OPERATION */
    readonly INVALID_FRAMEBUFFER_OPERATION: GLenum;
    /** Constant GL_UNPACK_FLIP_Y_WEBGL */
    readonly UNPACK_FLIP_Y_WEBGL: GLenum;
    /** Constant GL_UNPACK_PREMULTIPLY_ALPHA_WEBGL */
    readonly UNPACK_PREMULTIPLY_ALPHA_WEBGL: GLenum;
    /** Constant GL_CONTEXT_LOST_WEBGL */
    readonly CONTEXT_LOST_WEBGL: GLenum;
    /** Constant GL_UNPACK_COLORSPACE_CONVERSION_WEBGL */
    readonly UNPACK_COLORSPACE_CONVERSION_WEBGL: GLenum;
    /** Constant GL_BROWSER_DEFAULT_WEBGL */
    readonly BROWSER_DEFAULT_WEBGL: GLenum;
  }

  // ---------------------------------------------------------------------------
  // WebGL 2
  // ---------------------------------------------------------------------------

  /** GL buffer size */
  type GLsizeiptr = number;
  /** GL 64-bit integer (a JS number, exact up to 2^53) */
  type GLint64 = number;
  /** GL 64-bit unsigned integer (a JS number, exact up to 2^53) */
  type GLuint64 = number;
  /** Unsigned integer array argument: a Uint32Array or an array of numbers */
  type Uint32List = Uint32Array | ArrayLike<number>;

  /** WebGL query object */
  interface WebGLQuery { readonly __brand?: 'WebGLQuery' }
  /** WebGL sampler object */
  interface WebGLSampler { readonly __brand?: 'WebGLSampler' }
  /** WebGL sync object */
  interface WebGLSync { readonly __brand?: 'WebGLSync' }
  /** WebGL transform feedback object */
  interface WebGLTransformFeedback { readonly __brand?: 'WebGLTransformFeedback' }
  /** WebGL vertex array object (WebGL 2 createVertexArray; the same class as the OES_vertex_array_object objects) */
  interface WebGLVertexArrayObject { readonly __brand?: 'WebGLVertexArrayObject' }

  /** EXT_color_buffer_half_float extension */
  interface EXT_color_buffer_half_float {
    /** RGBA 16-bit float format */
    readonly RGBA16F_EXT: GLenum;
    /** RGB 16-bit float format */
    readonly RGB16F_EXT: GLenum;
    /** Framebuffer attachment component type */
    readonly FRAMEBUFFER_ATTACHMENT_COMPONENT_TYPE_EXT: GLenum;
    /** Unsigned normalized component type */
    readonly UNSIGNED_NORMALIZED_EXT: GLenum;
  }
  /** EXT_texture_norm16 extension */
  interface EXT_texture_norm16 {
    /** R 16-bit normalized */
    readonly R16_EXT: GLenum;
    /** RG 16-bit normalized */
    readonly RG16_EXT: GLenum;
    /** RGB 16-bit normalized */
    readonly RGB16_EXT: GLenum;
    /** RGBA 16-bit normalized */
    readonly RGBA16_EXT: GLenum;
    /** R 16-bit signed normalized */
    readonly R16_SNORM_EXT: GLenum;
    /** RG 16-bit signed normalized */
    readonly RG16_SNORM_EXT: GLenum;
    /** RGB 16-bit signed normalized */
    readonly RGB16_SNORM_EXT: GLenum;
    /** RGBA 16-bit signed normalized */
    readonly RGBA16_SNORM_EXT: GLenum;
  }
  /**
   * WEBGL_compressed_texture_s3tc extension (exposed when the driver has GL_EXT_texture_compression_dxt1)
   * @remarks Unconfirmed: the engine doesn't check the driver's DXT3/DXT5 support separately
   */
  interface WEBGL_compressed_texture_s3tc {
    /** DXT1 RGB */
    readonly COMPRESSED_RGB_S3TC_DXT1_EXT: GLenum;
    /** DXT1 RGBA */
    readonly COMPRESSED_RGBA_S3TC_DXT1_EXT: GLenum;
    /** DXT3 RGBA */
    readonly COMPRESSED_RGBA_S3TC_DXT3_EXT: GLenum;
    /** DXT5 RGBA */
    readonly COMPRESSED_RGBA_S3TC_DXT5_EXT: GLenum;
  }
  /** EXT_texture_compression_bptc extension */
  interface EXT_texture_compression_bptc {
    /** BC7 RGBA */
    readonly COMPRESSED_RGBA_BPTC_UNORM_EXT: GLenum;
    /** BC7 sRGB alpha */
    readonly COMPRESSED_SRGB_ALPHA_BPTC_UNORM_EXT: GLenum;
    /** BC6H signed float */
    readonly COMPRESSED_RGB_BPTC_SIGNED_FLOAT_EXT: GLenum;
    /** BC6H unsigned float */
    readonly COMPRESSED_RGB_BPTC_UNSIGNED_FLOAT_EXT: GLenum;
  }
  /** EXT_texture_compression_rgtc extension */
  interface EXT_texture_compression_rgtc {
    /** BC4 unsigned */
    readonly COMPRESSED_RED_RGTC1_EXT: GLenum;
    /** BC4 signed */
    readonly COMPRESSED_SIGNED_RED_RGTC1_EXT: GLenum;
    /** BC5 unsigned */
    readonly COMPRESSED_RED_GREEN_RGTC2_EXT: GLenum;
    /** BC5 signed */
    readonly COMPRESSED_SIGNED_RED_GREEN_RGTC2_EXT: GLenum;
  }
  /** WEBGL_compressed_texture_etc extension */
  interface WEBGL_compressed_texture_etc {
    /** EAC R11 */
    readonly COMPRESSED_R11_EAC: GLenum;
    /** EAC R11 signed */
    readonly COMPRESSED_SIGNED_R11_EAC: GLenum;
    /** EAC RG11 */
    readonly COMPRESSED_RG11_EAC: GLenum;
    /** EAC RG11 signed */
    readonly COMPRESSED_SIGNED_RG11_EAC: GLenum;
    /** ETC2 RGB8 */
    readonly COMPRESSED_RGB8_ETC2: GLenum;
    /** ETC2 sRGB8 */
    readonly COMPRESSED_SRGB8_ETC2: GLenum;
    /** ETC2 RGB8 with punchthrough alpha */
    readonly COMPRESSED_RGB8_PUNCHTHROUGH_ALPHA1_ETC2: GLenum;
    /** ETC2 sRGB8 with punchthrough alpha */
    readonly COMPRESSED_SRGB8_PUNCHTHROUGH_ALPHA1_ETC2: GLenum;
    /** ETC2 RGBA8 */
    readonly COMPRESSED_RGBA8_ETC2_EAC: GLenum;
    /** ETC2 sRGB8 alpha8 */
    readonly COMPRESSED_SRGB8_ALPHA8_ETC2_EAC: GLenum;
  }

  /**
   * Maps extension names to extension objects of a WebGL 2 context (actual availability depends on the GL driver).
   * Extensions that became core features of WebGL 2 (OES_vertex_array_object, ANGLE_instanced_arrays, WEBGL_depth_texture, ...) aren't exposed.
   */
  interface WebGL2ExtensionMap {
    /** Anisotropic filtering */
    EXT_texture_filter_anisotropic: EXT_texture_filter_anisotropic;
    /** PVRTC compressed textures */
    WEBGL_compressed_texture_pvrtc: WEBGL_compressed_texture_pvrtc;
    /** ASTC compressed textures */
    WEBGL_compressed_texture_astc: WEBGL_compressed_texture_astc;
    /** Linear filtering of 32-bit float textures */
    OES_texture_float_linear: EmptyExtension;
    /** Rendering to float color buffers */
    EXT_color_buffer_float: EmptyExtension;
    /** Rendering to half-float color buffers */
    EXT_color_buffer_half_float: EXT_color_buffer_half_float;
    /** Blending with 32-bit float color buffers */
    EXT_float_blend: EmptyExtension;
    /** 16-bit normalized textures */
    EXT_texture_norm16: EXT_texture_norm16;
    /** S3TC (DXT) compressed textures */
    WEBGL_compressed_texture_s3tc: WEBGL_compressed_texture_s3tc;
    /** BPTC (BC6H/BC7) compressed textures */
    EXT_texture_compression_bptc: EXT_texture_compression_bptc;
    /** RGTC (BC4/BC5) compressed textures */
    EXT_texture_compression_rgtc: EXT_texture_compression_rgtc;
    /** ETC2/EAC compressed textures */
    WEBGL_compressed_texture_etc: WEBGL_compressed_texture_etc;
  }

  /**
   * WebGL 2 rendering context (WebGL2RenderingContext), backed by an OpenGL ES 3.0 ANGLE context.
   * Has every member of WebGLRenderingContext; the methods redeclared here take the WebGL 2 overloads.
   *
   * Pixel sources: `pboOffset` is a byte offset into the bound PIXEL_UNPACK_BUFFER (PIXEL_PACK_BUFFER for readPixels);
   * `srcOffset`/`dstOffset`/`srcLength`/`length` count elements of the typed array, and 0 or omitted means "to the end".
   */
  interface WebGL2RenderingContext extends WebGLRenderingContext {
    /** Gets an extension object, or null if it isn't supported */
    getExtension<K extends keyof WebGL2ExtensionMap>(name: K): WebGL2ExtensionMap[K] | null;
    /** WebGL 1 extensions that are core in WebGL 2 always return null */
    getExtension(name: Exclude<keyof WebGLExtensionMap, keyof WebGL2ExtensionMap>): null;
    /** Gets an extension object, or null if it isn't supported */
    getExtension(name: string): object | null;

    // ---- WebGL 1 methods with WebGL 2 overloads ----
    /**
     * Queries a parameter; in addition to WebGL 1: the new buffer/framebuffer/sampler/texture/transform feedback/vertex array
     * bindings return the object or null, RASTERIZER_DISCARD and TRANSFORM_FEEDBACK_ACTIVE/PAUSED are booleans,
     * MAX_CLIENT_WAIT_TIMEOUT_WEBGL is 0
     */
    getParameter(pname: GLenum): any;
    /** Reads a uniform value: a number or boolean for scalars, a Float32Array/Int32Array/Uint32Array or boolean[] otherwise; null if not found */
    getUniform(program: WebGLProgram, location: WebGLUniformLocation): any;
    /** Allocates a buffer of size bytes */
    bufferData(target: GLenum, size: GLsizeiptr, usage: GLenum): void;
    /** Uploads buffer data, optionally only length elements from srcOffset */
    bufferData(target: GLenum, srcData: ArrayBuffer | ArrayBufferView, usage: GLenum, srcOffset?: GLuint, length?: GLuint): void;
    /** Updates part of the buffer data, optionally only length elements from srcOffset */
    bufferSubData(target: GLenum, dstByteOffset: GLintptr, srcData: ArrayBuffer | ArrayBufferView, srcOffset?: GLuint, length?: GLuint): void;
    /** Uploads a texture from a canvas, image or pixel data, at its own size (6-argument form) */
    texImage2D(target: GLenum, level: GLint, internalformat: GLint, format: GLenum, type: GLenum, source: CanvasDrawable): void;
    /** Uploads a texture from the bound PIXEL_UNPACK_BUFFER */
    texImage2D(target: GLenum, level: GLint, internalformat: GLint, width: GLsizei, height: GLsizei, border: GLint, format: GLenum, type: GLenum, pboOffset: GLintptr): void;
    /**
     * Uploads the width × height region of a canvas, image or pixel data starting at UNPACK_SKIP_PIXELS/UNPACK_SKIP_ROWS
     * (zero outside the source)
     */
    texImage2D(target: GLenum, level: GLint, internalformat: GLint, width: GLsizei, height: GLsizei, border: GLint, format: GLenum, type: GLenum, source: CanvasDrawable): void;
    /** Uploads a texture from a typed array matching type, starting at element srcOffset (null only allocates it) */
    texImage2D(target: GLenum, level: GLint, internalformat: GLint, width: GLsizei, height: GLsizei, border: GLint, format: GLenum, type: GLenum, srcData: ArrayBufferView | null, srcOffset?: GLuint): void;
    /** Updates a texture from a canvas, image or pixel data, at its own size (7-argument form) */
    texSubImage2D(target: GLenum, level: GLint, xoffset: GLint, yoffset: GLint, format: GLenum, type: GLenum, source: CanvasDrawable): void;
    /** Updates a texture from the bound PIXEL_UNPACK_BUFFER */
    texSubImage2D(target: GLenum, level: GLint, xoffset: GLint, yoffset: GLint, width: GLsizei, height: GLsizei, format: GLenum, type: GLenum, pboOffset: GLintptr): void;
    /**
     * Updates a texture from the width × height region of a canvas, image or pixel data starting at
     * UNPACK_SKIP_PIXELS/UNPACK_SKIP_ROWS (zero outside the source)
     */
    texSubImage2D(target: GLenum, level: GLint, xoffset: GLint, yoffset: GLint, width: GLsizei, height: GLsizei, format: GLenum, type: GLenum, source: CanvasDrawable): void;
    /** Updates a texture from a typed array matching type, starting at element srcOffset */
    texSubImage2D(target: GLenum, level: GLint, xoffset: GLint, yoffset: GLint, width: GLsizei, height: GLsizei, format: GLenum, type: GLenum, srcData: ArrayBufferView | null, srcOffset?: GLuint): void;
    /** Uploads a compressed texture from the bound PIXEL_UNPACK_BUFFER */
    compressedTexImage2D(target: GLenum, level: GLint, internalformat: GLenum, width: GLsizei, height: GLsizei, border: GLint, imageSize: GLsizei, offset: GLintptr): void;
    /** Uploads a compressed texture, optionally only srcLengthOverride elements from srcOffset */
    compressedTexImage2D(target: GLenum, level: GLint, internalformat: GLenum, width: GLsizei, height: GLsizei, border: GLint, srcData: ArrayBufferView, srcOffset?: GLuint, srcLengthOverride?: GLuint): void;
    /** Updates a compressed texture from the bound PIXEL_UNPACK_BUFFER */
    compressedTexSubImage2D(target: GLenum, level: GLint, xoffset: GLint, yoffset: GLint, width: GLsizei, height: GLsizei, format: GLenum, imageSize: GLsizei, offset: GLintptr): void;
    /** Updates a compressed texture, optionally only srcLengthOverride elements from srcOffset */
    compressedTexSubImage2D(target: GLenum, level: GLint, xoffset: GLint, yoffset: GLint, width: GLsizei, height: GLsizei, format: GLenum, srcData: ArrayBufferView, srcOffset?: GLuint, srcLengthOverride?: GLuint): void;
    /** Reads pixels into a typed array matching type, starting at element dstOffset */
    readPixels(x: GLint, y: GLint, width: GLsizei, height: GLsizei, format: GLenum, type: GLenum, dstData: ArrayBufferView, dstOffset?: GLuint): void;
    /** Reads pixels into the bound PIXEL_PACK_BUFFER */
    readPixels(x: GLint, y: GLint, width: GLsizei, height: GLsizei, format: GLenum, type: GLenum, offset: GLintptr): void;
    /** Sets a float array uniform */
    uniform1fv(location: WebGLUniformLocation | null, data: Float32List, srcOffset?: GLuint, srcLength?: GLuint): void;
    /** Sets a vec2 array uniform */
    uniform2fv(location: WebGLUniformLocation | null, data: Float32List, srcOffset?: GLuint, srcLength?: GLuint): void;
    /** Sets a vec3 array uniform */
    uniform3fv(location: WebGLUniformLocation | null, data: Float32List, srcOffset?: GLuint, srcLength?: GLuint): void;
    /** Sets a vec4 array uniform */
    uniform4fv(location: WebGLUniformLocation | null, data: Float32List, srcOffset?: GLuint, srcLength?: GLuint): void;
    /** Sets an int array uniform */
    uniform1iv(location: WebGLUniformLocation | null, data: Int32List, srcOffset?: GLuint, srcLength?: GLuint): void;
    /** Sets an ivec2 array uniform */
    uniform2iv(location: WebGLUniformLocation | null, data: Int32List, srcOffset?: GLuint, srcLength?: GLuint): void;
    /** Sets an ivec3 array uniform */
    uniform3iv(location: WebGLUniformLocation | null, data: Int32List, srcOffset?: GLuint, srcLength?: GLuint): void;
    /** Sets an ivec4 array uniform */
    uniform4iv(location: WebGLUniformLocation | null, data: Int32List, srcOffset?: GLuint, srcLength?: GLuint): void;
    /** Sets a mat2 uniform */
    uniformMatrix2fv(location: WebGLUniformLocation | null, transpose: boolean, data: Float32List, srcOffset?: GLuint, srcLength?: GLuint): void;
    /** Sets a mat3 uniform */
    uniformMatrix3fv(location: WebGLUniformLocation | null, transpose: boolean, data: Float32List, srcOffset?: GLuint, srcLength?: GLuint): void;
    /** Sets a mat4 uniform */
    uniformMatrix4fv(location: WebGLUniformLocation | null, transpose: boolean, data: Float32List, srcOffset?: GLuint, srcLength?: GLuint): void;

    // ---- Buffer objects ----
    /** Copies between buffers */
    copyBufferSubData(readTarget: GLenum, writeTarget: GLenum, readOffset: GLintptr, writeOffset: GLintptr, size: GLsizeiptr): void;
    /** Reads buffer data into dstBuffer, optionally only length elements from dstOffset */
    getBufferSubData(target: GLenum, srcByteOffset: GLintptr, dstBuffer: ArrayBufferView, dstOffset?: GLuint, length?: GLuint): void;

    // ---- Framebuffer objects ----
    /** Copies a rectangle from the read framebuffer to the draw framebuffer */
    blitFramebuffer(srcX0: GLint, srcY0: GLint, srcX1: GLint, srcY1: GLint, dstX0: GLint, dstY0: GLint, dstX1: GLint, dstY1: GLint, mask: GLbitfield, filter: GLenum): void;
    /** Attaches a layer of a 3D or 2D array texture to the framebuffer */
    framebufferTextureLayer(target: GLenum, attachment: GLenum, texture: WebGLTexture | null, level: GLint, layer: GLint): void;
    /** Invalidates framebuffer attachments */
    invalidateFramebuffer(target: GLenum, attachments: ArrayLike<GLenum>): void;
    /** Invalidates a region of framebuffer attachments */
    invalidateSubFramebuffer(target: GLenum, attachments: ArrayLike<GLenum>, x: GLint, y: GLint, width: GLsizei, height: GLsizei): void;
    /** Selects the color buffer to read from */
    readBuffer(src: GLenum): void;

    // ---- Renderbuffer objects ----
    /** Queries an internal format; only SAMPLES is supported (an Int32Array), other pnames return null */
    getInternalformatParameter(target: GLenum, internalformat: GLenum, pname: GLenum): Int32Array | null;
    /** Allocates multisampled renderbuffer storage (DEPTH_STENCIL means DEPTH24_STENCIL8) */
    renderbufferStorageMultisample(target: GLenum, samples: GLsizei, internalformat: GLenum, width: GLsizei, height: GLsizei): void;

    // ---- Texture objects ----
    /** Allocates immutable storage for a 2D or cube map texture */
    texStorage2D(target: GLenum, levels: GLsizei, internalformat: GLenum, width: GLsizei, height: GLsizei): void;
    /** Allocates immutable storage for a 3D or 2D array texture */
    texStorage3D(target: GLenum, levels: GLsizei, internalformat: GLenum, width: GLsizei, height: GLsizei, depth: GLsizei): void;
    /** Uploads a 3D or 2D array texture from the bound PIXEL_UNPACK_BUFFER */
    texImage3D(target: GLenum, level: GLint, internalformat: GLint, width: GLsizei, height: GLsizei, depth: GLsizei, border: GLint, format: GLenum, type: GLenum, pboOffset: GLintptr): void;
    /**
     * Uploads a 3D or 2D array texture from a canvas, image or pixel data: `depth` slices of width × height stacked top to
     * bottom in the source, UNPACK_IMAGE_HEIGHT rows apart (height if 0), starting at UNPACK_SKIP_PIXELS/UNPACK_SKIP_ROWS
     * after UNPACK_SKIP_IMAGES slices (zero outside the source). UNPACK_FLIP_Y_WEBGL flips each slice.
     */
    texImage3D(target: GLenum, level: GLint, internalformat: GLint, width: GLsizei, height: GLsizei, depth: GLsizei, border: GLint, format: GLenum, type: GLenum, source: CanvasDrawable): void;
    /** Uploads a 3D or 2D array texture from a typed array matching type, starting at element srcOffset (null only allocates it) */
    texImage3D(target: GLenum, level: GLint, internalformat: GLint, width: GLsizei, height: GLsizei, depth: GLsizei, border: GLint, format: GLenum, type: GLenum, srcData: ArrayBufferView | null, srcOffset?: GLuint): void;
    /** Updates a 3D or 2D array texture from the bound PIXEL_UNPACK_BUFFER */
    texSubImage3D(target: GLenum, level: GLint, xoffset: GLint, yoffset: GLint, zoffset: GLint, width: GLsizei, height: GLsizei, depth: GLsizei, format: GLenum, type: GLenum, pboOffset: GLintptr): void;
    /** Updates a 3D or 2D array texture from a canvas, image or pixel data, whose slices are selected as in texImage3D */
    texSubImage3D(target: GLenum, level: GLint, xoffset: GLint, yoffset: GLint, zoffset: GLint, width: GLsizei, height: GLsizei, depth: GLsizei, format: GLenum, type: GLenum, source: CanvasDrawable): void;
    /** Updates a 3D or 2D array texture from a typed array matching type, starting at element srcOffset */
    texSubImage3D(target: GLenum, level: GLint, xoffset: GLint, yoffset: GLint, zoffset: GLint, width: GLsizei, height: GLsizei, depth: GLsizei, format: GLenum, type: GLenum, srcData: ArrayBufferView, srcOffset?: GLuint): void;
    /** Copies part of a 3D or 2D array texture layer from the read framebuffer */
    copyTexSubImage3D(target: GLenum, level: GLint, xoffset: GLint, yoffset: GLint, zoffset: GLint, x: GLint, y: GLint, width: GLsizei, height: GLsizei): void;
    /** Uploads a compressed 3D or 2D array texture from the bound PIXEL_UNPACK_BUFFER */
    compressedTexImage3D(target: GLenum, level: GLint, internalformat: GLenum, width: GLsizei, height: GLsizei, depth: GLsizei, border: GLint, imageSize: GLsizei, offset: GLintptr): void;
    /** Uploads a compressed 3D or 2D array texture, optionally only srcLengthOverride elements from srcOffset */
    compressedTexImage3D(target: GLenum, level: GLint, internalformat: GLenum, width: GLsizei, height: GLsizei, depth: GLsizei, border: GLint, srcData: ArrayBufferView, srcOffset?: GLuint, srcLengthOverride?: GLuint): void;
    /** Updates a compressed 3D or 2D array texture from the bound PIXEL_UNPACK_BUFFER */
    compressedTexSubImage3D(target: GLenum, level: GLint, xoffset: GLint, yoffset: GLint, zoffset: GLint, width: GLsizei, height: GLsizei, depth: GLsizei, format: GLenum, imageSize: GLsizei, offset: GLintptr): void;
    /** Updates a compressed 3D or 2D array texture, optionally only srcLengthOverride elements from srcOffset */
    compressedTexSubImage3D(target: GLenum, level: GLint, xoffset: GLint, yoffset: GLint, zoffset: GLint, width: GLsizei, height: GLsizei, depth: GLsizei, format: GLenum, srcData: ArrayBufferView, srcOffset?: GLuint, srcLengthOverride?: GLuint): void;

    // ---- Programs and shaders ----
    /** Gets the color number bound to a fragment shader output (-1 if none) */
    getFragDataLocation(program: WebGLProgram, name: string): GLint;

    // ---- Uniforms ----
    /** Sets a uint uniform */
    uniform1ui(location: WebGLUniformLocation | null, v0: GLuint): void;
    /** Sets a uvec2 uniform */
    uniform2ui(location: WebGLUniformLocation | null, v0: GLuint, v1: GLuint): void;
    /** Sets a uvec3 uniform */
    uniform3ui(location: WebGLUniformLocation | null, v0: GLuint, v1: GLuint, v2: GLuint): void;
    /** Sets a uvec4 uniform */
    uniform4ui(location: WebGLUniformLocation | null, v0: GLuint, v1: GLuint, v2: GLuint, v3: GLuint): void;
    /** Sets a uint array uniform */
    uniform1uiv(location: WebGLUniformLocation | null, data: Uint32List, srcOffset?: GLuint, srcLength?: GLuint): void;
    /** Sets a uvec2 array uniform */
    uniform2uiv(location: WebGLUniformLocation | null, data: Uint32List, srcOffset?: GLuint, srcLength?: GLuint): void;
    /** Sets a uvec3 array uniform */
    uniform3uiv(location: WebGLUniformLocation | null, data: Uint32List, srcOffset?: GLuint, srcLength?: GLuint): void;
    /** Sets a uvec4 array uniform */
    uniform4uiv(location: WebGLUniformLocation | null, data: Uint32List, srcOffset?: GLuint, srcLength?: GLuint): void;
    /** Sets a mat2x3 uniform */
    uniformMatrix2x3fv(location: WebGLUniformLocation | null, transpose: boolean, data: Float32List, srcOffset?: GLuint, srcLength?: GLuint): void;
    /** Sets a mat2x4 uniform */
    uniformMatrix2x4fv(location: WebGLUniformLocation | null, transpose: boolean, data: Float32List, srcOffset?: GLuint, srcLength?: GLuint): void;
    /** Sets a mat3x2 uniform */
    uniformMatrix3x2fv(location: WebGLUniformLocation | null, transpose: boolean, data: Float32List, srcOffset?: GLuint, srcLength?: GLuint): void;
    /** Sets a mat3x4 uniform */
    uniformMatrix3x4fv(location: WebGLUniformLocation | null, transpose: boolean, data: Float32List, srcOffset?: GLuint, srcLength?: GLuint): void;
    /** Sets a mat4x2 uniform */
    uniformMatrix4x2fv(location: WebGLUniformLocation | null, transpose: boolean, data: Float32List, srcOffset?: GLuint, srcLength?: GLuint): void;
    /** Sets a mat4x3 uniform */
    uniformMatrix4x3fv(location: WebGLUniformLocation | null, transpose: boolean, data: Float32List, srcOffset?: GLuint, srcLength?: GLuint): void;

    // ---- Vertex attribs ----
    /** Sets a constant integer vertex attribute */
    vertexAttribI4i(index: GLuint, x: GLint, y: GLint, z: GLint, w: GLint): void;
    /** Sets a constant unsigned integer vertex attribute */
    vertexAttribI4ui(index: GLuint, x: GLuint, y: GLuint, z: GLuint, w: GLuint): void;
    /** Sets a constant integer vertex attribute from an array (at least 4 values) */
    vertexAttribI4iv(index: GLuint, values: Int32List): void;
    /** Sets a constant unsigned integer vertex attribute from an array (at least 4 values) */
    vertexAttribI4uiv(index: GLuint, values: Uint32List): void;
    /** Integer vertex attribute pointer */
    vertexAttribIPointer(index: GLuint, size: GLint, type: GLenum, stride: GLsizei, offset: GLintptr): void;

    // ---- Writing to the drawing buffer ----
    /** Sets the instance divisor of an attribute */
    vertexAttribDivisor(index: GLuint, divisor: GLuint): void;
    /** Draws arrays with instancing */
    drawArraysInstanced(mode: GLenum, first: GLint, count: GLsizei, instanceCount: GLsizei): void;
    /** Draws elements with instancing */
    drawElementsInstanced(mode: GLenum, count: GLsizei, type: GLenum, offset: GLintptr, instanceCount: GLsizei): void;
    /** Draws elements whose indices are within [start, end] */
    drawRangeElements(mode: GLenum, start: GLuint, end: GLuint, count: GLsizei, type: GLenum, offset: GLintptr): void;

    // ---- Multiple render targets ----
    /** Selects the color buffers to draw into (BACK for the canvas itself) */
    drawBuffers(buffers: ArrayLike<GLenum>): void;
    /** Clears a float color buffer, or the depth buffer, from values starting at srcOffset */
    clearBufferfv(buffer: GLenum, drawbuffer: GLint, values: Float32List, srcOffset?: GLuint): void;
    /** Clears a signed integer color buffer, or the stencil buffer, from values starting at srcOffset */
    clearBufferiv(buffer: GLenum, drawbuffer: GLint, values: Int32List, srcOffset?: GLuint): void;
    /** Clears an unsigned integer color buffer from values starting at srcOffset */
    clearBufferuiv(buffer: GLenum, drawbuffer: GLint, values: Uint32List, srcOffset?: GLuint): void;
    /** Clears the depth and stencil buffers (buffer is DEPTH_STENCIL) */
    clearBufferfi(buffer: GLenum, drawbuffer: GLint, depth: GLfloat, stencil: GLint): void;

    // ---- Query objects ----
    /** Creates a query */
    createQuery(): WebGLQuery;
    /** Deletes a query */
    deleteQuery(query: WebGLQuery | null): void;
    /** Returns whether the object is a query */
    isQuery(query: WebGLQuery | null): boolean;
    /** Starts a query (ANY_SAMPLES_PASSED, ANY_SAMPLES_PASSED_CONSERVATIVE or TRANSFORM_FEEDBACK_PRIMITIVES_WRITTEN) */
    beginQuery(target: GLenum, query: WebGLQuery): void;
    /** Ends the active query of target */
    endQuery(target: GLenum): void;
    /** Gets the active query of target; only CURRENT_QUERY is supported, other pnames return null */
    getQuery(target: GLenum, pname: GLenum): WebGLQuery | null;
    /** Queries a query result: QUERY_RESULT_AVAILABLE is a boolean, QUERY_RESULT a number */
    getQueryParameter(query: WebGLQuery, pname: GLenum): any;

    // ---- Sampler objects ----
    /** Creates a sampler */
    createSampler(): WebGLSampler;
    /** Deletes a sampler */
    deleteSampler(sampler: WebGLSampler | null): void;
    /** Returns whether the object is a sampler */
    isSampler(sampler: WebGLSampler | null): boolean;
    /** Binds a sampler to a texture unit (null unbinds it) */
    bindSampler(unit: GLuint, sampler: WebGLSampler | null): void;
    /** Integer sampler parameter */
    samplerParameteri(sampler: WebGLSampler, pname: GLenum, param: GLint): void;
    /** Float sampler parameter */
    samplerParameterf(sampler: WebGLSampler, pname: GLenum, param: GLfloat): void;
    /** Queries a sampler parameter */
    getSamplerParameter(sampler: WebGLSampler, pname: GLenum): number;

    // ---- Sync objects ----
    /** Inserts a fence (condition SYNC_GPU_COMMANDS_COMPLETE, flags 0); null if GL fails to create it */
    fenceSync(condition: GLenum, flags: GLbitfield): WebGLSync | null;
    /** Returns whether the object is a live sync object */
    isSync(sync: WebGLSync | null): boolean;
    /** Deletes a sync object */
    deleteSync(sync: WebGLSync | null): void;
    /**
     * Waits for a sync object on the CPU and returns ALREADY_SIGNALED, TIMEOUT_EXPIRED, CONDITION_SATISFIED or WAIT_FAILED.
     * timeout is in nanoseconds and passed to GL as is; getParameter(MAX_CLIENT_WAIT_TIMEOUT_WEBGL) reports 0, so portable code polls with 0.
     */
    clientWaitSync(sync: WebGLSync, flags: GLbitfield, timeout: GLuint64): GLenum;
    /** Makes the GPU wait for a sync object; timeout must be TIMEOUT_IGNORED (it's ignored) */
    waitSync(sync: WebGLSync, flags: GLbitfield, timeout: GLint64): void;
    /** Queries a sync object parameter (OBJECT_TYPE, SYNC_STATUS, SYNC_CONDITION, SYNC_FLAGS); null if the sync was deleted */
    getSyncParameter(sync: WebGLSync, pname: GLenum): number | null;

    // ---- Transform feedback ----
    /** Creates a transform feedback object */
    createTransformFeedback(): WebGLTransformFeedback;
    /** Deletes a transform feedback object */
    deleteTransformFeedback(tf: WebGLTransformFeedback | null): void;
    /** Returns whether the object is a transform feedback object */
    isTransformFeedback(tf: WebGLTransformFeedback | null): boolean;
    /** Binds a transform feedback object (null binds the default one) */
    bindTransformFeedback(target: GLenum, tf: WebGLTransformFeedback | null): void;
    /** Starts transform feedback */
    beginTransformFeedback(primitiveMode: GLenum): void;
    /** Ends transform feedback */
    endTransformFeedback(): void;
    /** Pauses transform feedback */
    pauseTransformFeedback(): void;
    /** Resumes transform feedback */
    resumeTransformFeedback(): void;
    /** Sets the varyings to capture; takes effect on the next linkProgram */
    transformFeedbackVaryings(program: WebGLProgram, varyings: ArrayLike<string>, bufferMode: GLenum): void;
    /** Gets information about a captured varying */
    getTransformFeedbackVarying(program: WebGLProgram, index: GLuint): WebGLActiveInfo | null;

    // ---- Uniform buffer objects and transform feedback buffers ----
    /** Binds a buffer to an indexed UNIFORM_BUFFER or TRANSFORM_FEEDBACK_BUFFER binding point */
    bindBufferBase(target: GLenum, index: GLuint, buffer: WebGLBuffer | null): void;
    /** Binds a range of a buffer to an indexed binding point */
    bindBufferRange(target: GLenum, index: GLuint, buffer: WebGLBuffer | null, offset: GLintptr, size: GLsizeiptr): void;
    /** Queries an indexed binding: *_BUFFER_BINDING returns the WebGLBuffer or null, *_BUFFER_START/SIZE a number, other targets null */
    getIndexedParameter(target: GLenum, index: GLuint): any;
    /** Gets the indices of uniforms by name (INVALID_INDEX for unknown names) */
    getUniformIndices(program: WebGLProgram, uniformNames: ArrayLike<string>): GLuint[];
    /** Queries uniforms: an array with a number per uniform, or a boolean per uniform for UNIFORM_IS_ROW_MAJOR */
    getActiveUniforms(program: WebGLProgram, uniformIndices: ArrayLike<GLuint>, pname: GLenum): any;
    /** Gets the index of a uniform block (INVALID_INDEX if not found) */
    getUniformBlockIndex(program: WebGLProgram, uniformBlockName: string): GLuint;
    /**
     * Queries a uniform block: UNIFORM_BLOCK_ACTIVE_UNIFORM_INDICES is a Uint32Array,
     * UNIFORM_BLOCK_REFERENCED_BY_VERTEX/FRAGMENT_SHADER booleans, the rest numbers
     */
    getActiveUniformBlockParameter(program: WebGLProgram, uniformBlockIndex: GLuint, pname: GLenum): any;
    /** Gets the name of a uniform block */
    getActiveUniformBlockName(program: WebGLProgram, uniformBlockIndex: GLuint): string | null;
    /** Assigns a uniform block to a UNIFORM_BUFFER binding point */
    uniformBlockBinding(program: WebGLProgram, uniformBlockIndex: GLuint, uniformBlockBinding: GLuint): void;

    // ---- Vertex array objects ----
    /** Creates a VAO */
    createVertexArray(): WebGLVertexArrayObject;
    /** Deletes a VAO */
    deleteVertexArray(vertexArray: WebGLVertexArrayObject | null): void;
    /** Returns whether the object is a VAO */
    isVertexArray(vertexArray: WebGLVertexArrayObject | null): boolean;
    /** Binds a VAO (null binds the default one) */
    bindVertexArray(array: WebGLVertexArrayObject | null): void;

    // ---- Constants (in addition to the ones of WebGLRenderingContext) ----
    /** Constant GL_READ_BUFFER */
    readonly READ_BUFFER: GLenum;
    /** Constant GL_UNPACK_ROW_LENGTH */
    readonly UNPACK_ROW_LENGTH: GLenum;
    /** Constant GL_UNPACK_SKIP_ROWS */
    readonly UNPACK_SKIP_ROWS: GLenum;
    /** Constant GL_UNPACK_SKIP_PIXELS */
    readonly UNPACK_SKIP_PIXELS: GLenum;
    /** Constant GL_PACK_ROW_LENGTH */
    readonly PACK_ROW_LENGTH: GLenum;
    /** Constant GL_PACK_SKIP_ROWS */
    readonly PACK_SKIP_ROWS: GLenum;
    /** Constant GL_PACK_SKIP_PIXELS */
    readonly PACK_SKIP_PIXELS: GLenum;
    /** Constant GL_COLOR */
    readonly COLOR: GLenum;
    /** Constant GL_DEPTH */
    readonly DEPTH: GLenum;
    /** Constant GL_STENCIL */
    readonly STENCIL: GLenum;
    /** Constant GL_RED */
    readonly RED: GLenum;
    /** Constant GL_RGB8 */
    readonly RGB8: GLenum;
    /** Constant GL_RGBA8 */
    readonly RGBA8: GLenum;
    /** Constant GL_RGB10_A2 */
    readonly RGB10_A2: GLenum;
    /** Constant GL_TEXTURE_BINDING_3D */
    readonly TEXTURE_BINDING_3D: GLenum;
    /** Constant GL_UNPACK_SKIP_IMAGES */
    readonly UNPACK_SKIP_IMAGES: GLenum;
    /** Constant GL_UNPACK_IMAGE_HEIGHT */
    readonly UNPACK_IMAGE_HEIGHT: GLenum;
    /** Constant GL_TEXTURE_3D */
    readonly TEXTURE_3D: GLenum;
    /** Constant GL_TEXTURE_WRAP_R */
    readonly TEXTURE_WRAP_R: GLenum;
    /** Constant GL_MAX_3D_TEXTURE_SIZE */
    readonly MAX_3D_TEXTURE_SIZE: GLenum;
    /** Constant GL_UNSIGNED_INT_2_10_10_10_REV */
    readonly UNSIGNED_INT_2_10_10_10_REV: GLenum;
    /** Constant GL_MAX_ELEMENTS_VERTICES */
    readonly MAX_ELEMENTS_VERTICES: GLenum;
    /** Constant GL_MAX_ELEMENTS_INDICES */
    readonly MAX_ELEMENTS_INDICES: GLenum;
    /** Constant GL_TEXTURE_MIN_LOD */
    readonly TEXTURE_MIN_LOD: GLenum;
    /** Constant GL_TEXTURE_MAX_LOD */
    readonly TEXTURE_MAX_LOD: GLenum;
    /** Constant GL_TEXTURE_BASE_LEVEL */
    readonly TEXTURE_BASE_LEVEL: GLenum;
    /** Constant GL_TEXTURE_MAX_LEVEL */
    readonly TEXTURE_MAX_LEVEL: GLenum;
    /** Constant GL_MIN */
    readonly MIN: GLenum;
    /** Constant GL_MAX */
    readonly MAX: GLenum;
    /** Constant GL_DEPTH_COMPONENT24 */
    readonly DEPTH_COMPONENT24: GLenum;
    /** Constant GL_MAX_TEXTURE_LOD_BIAS */
    readonly MAX_TEXTURE_LOD_BIAS: GLenum;
    /** Constant GL_TEXTURE_COMPARE_MODE */
    readonly TEXTURE_COMPARE_MODE: GLenum;
    /** Constant GL_TEXTURE_COMPARE_FUNC */
    readonly TEXTURE_COMPARE_FUNC: GLenum;
    /** Constant GL_CURRENT_QUERY */
    readonly CURRENT_QUERY: GLenum;
    /** Constant GL_QUERY_RESULT */
    readonly QUERY_RESULT: GLenum;
    /** Constant GL_QUERY_RESULT_AVAILABLE */
    readonly QUERY_RESULT_AVAILABLE: GLenum;
    /** Constant GL_STREAM_READ */
    readonly STREAM_READ: GLenum;
    /** Constant GL_STREAM_COPY */
    readonly STREAM_COPY: GLenum;
    /** Constant GL_STATIC_READ */
    readonly STATIC_READ: GLenum;
    /** Constant GL_STATIC_COPY */
    readonly STATIC_COPY: GLenum;
    /** Constant GL_DYNAMIC_READ */
    readonly DYNAMIC_READ: GLenum;
    /** Constant GL_DYNAMIC_COPY */
    readonly DYNAMIC_COPY: GLenum;
    /** Constant GL_MAX_DRAW_BUFFERS */
    readonly MAX_DRAW_BUFFERS: GLenum;
    /** Constant GL_DRAW_BUFFER0 */
    readonly DRAW_BUFFER0: GLenum;
    /** Constant GL_DRAW_BUFFER1 */
    readonly DRAW_BUFFER1: GLenum;
    /** Constant GL_DRAW_BUFFER2 */
    readonly DRAW_BUFFER2: GLenum;
    /** Constant GL_DRAW_BUFFER3 */
    readonly DRAW_BUFFER3: GLenum;
    /** Constant GL_DRAW_BUFFER4 */
    readonly DRAW_BUFFER4: GLenum;
    /** Constant GL_DRAW_BUFFER5 */
    readonly DRAW_BUFFER5: GLenum;
    /** Constant GL_DRAW_BUFFER6 */
    readonly DRAW_BUFFER6: GLenum;
    /** Constant GL_DRAW_BUFFER7 */
    readonly DRAW_BUFFER7: GLenum;
    /** Constant GL_DRAW_BUFFER8 */
    readonly DRAW_BUFFER8: GLenum;
    /** Constant GL_DRAW_BUFFER9 */
    readonly DRAW_BUFFER9: GLenum;
    /** Constant GL_DRAW_BUFFER10 */
    readonly DRAW_BUFFER10: GLenum;
    /** Constant GL_DRAW_BUFFER11 */
    readonly DRAW_BUFFER11: GLenum;
    /** Constant GL_DRAW_BUFFER12 */
    readonly DRAW_BUFFER12: GLenum;
    /** Constant GL_DRAW_BUFFER13 */
    readonly DRAW_BUFFER13: GLenum;
    /** Constant GL_DRAW_BUFFER14 */
    readonly DRAW_BUFFER14: GLenum;
    /** Constant GL_DRAW_BUFFER15 */
    readonly DRAW_BUFFER15: GLenum;
    /** Constant GL_MAX_FRAGMENT_UNIFORM_COMPONENTS */
    readonly MAX_FRAGMENT_UNIFORM_COMPONENTS: GLenum;
    /** Constant GL_MAX_VERTEX_UNIFORM_COMPONENTS */
    readonly MAX_VERTEX_UNIFORM_COMPONENTS: GLenum;
    /** Constant GL_SAMPLER_3D */
    readonly SAMPLER_3D: GLenum;
    /** Constant GL_SAMPLER_2D_SHADOW */
    readonly SAMPLER_2D_SHADOW: GLenum;
    /** Constant GL_FRAGMENT_SHADER_DERIVATIVE_HINT */
    readonly FRAGMENT_SHADER_DERIVATIVE_HINT: GLenum;
    /** Constant GL_PIXEL_PACK_BUFFER */
    readonly PIXEL_PACK_BUFFER: GLenum;
    /** Constant GL_PIXEL_UNPACK_BUFFER */
    readonly PIXEL_UNPACK_BUFFER: GLenum;
    /** Constant GL_PIXEL_PACK_BUFFER_BINDING */
    readonly PIXEL_PACK_BUFFER_BINDING: GLenum;
    /** Constant GL_PIXEL_UNPACK_BUFFER_BINDING */
    readonly PIXEL_UNPACK_BUFFER_BINDING: GLenum;
    /** Constant GL_FLOAT_MAT2x3 */
    readonly FLOAT_MAT2x3: GLenum;
    /** Constant GL_FLOAT_MAT2x4 */
    readonly FLOAT_MAT2x4: GLenum;
    /** Constant GL_FLOAT_MAT3x2 */
    readonly FLOAT_MAT3x2: GLenum;
    /** Constant GL_FLOAT_MAT3x4 */
    readonly FLOAT_MAT3x4: GLenum;
    /** Constant GL_FLOAT_MAT4x2 */
    readonly FLOAT_MAT4x2: GLenum;
    /** Constant GL_FLOAT_MAT4x3 */
    readonly FLOAT_MAT4x3: GLenum;
    /** Constant GL_SRGB */
    readonly SRGB: GLenum;
    /** Constant GL_SRGB8 */
    readonly SRGB8: GLenum;
    /** Constant GL_SRGB8_ALPHA8 */
    readonly SRGB8_ALPHA8: GLenum;
    /** Constant GL_COMPARE_REF_TO_TEXTURE */
    readonly COMPARE_REF_TO_TEXTURE: GLenum;
    /** Constant GL_RGBA32F */
    readonly RGBA32F: GLenum;
    /** Constant GL_RGB32F */
    readonly RGB32F: GLenum;
    /** Constant GL_RGBA16F */
    readonly RGBA16F: GLenum;
    /** Constant GL_RGB16F */
    readonly RGB16F: GLenum;
    /** Constant GL_VERTEX_ATTRIB_ARRAY_INTEGER */
    readonly VERTEX_ATTRIB_ARRAY_INTEGER: GLenum;
    /** Constant GL_MAX_ARRAY_TEXTURE_LAYERS */
    readonly MAX_ARRAY_TEXTURE_LAYERS: GLenum;
    /** Constant GL_MIN_PROGRAM_TEXEL_OFFSET */
    readonly MIN_PROGRAM_TEXEL_OFFSET: GLenum;
    /** Constant GL_MAX_PROGRAM_TEXEL_OFFSET */
    readonly MAX_PROGRAM_TEXEL_OFFSET: GLenum;
    /** Constant GL_MAX_VARYING_COMPONENTS */
    readonly MAX_VARYING_COMPONENTS: GLenum;
    /** Constant GL_TEXTURE_2D_ARRAY */
    readonly TEXTURE_2D_ARRAY: GLenum;
    /** Constant GL_TEXTURE_BINDING_2D_ARRAY */
    readonly TEXTURE_BINDING_2D_ARRAY: GLenum;
    /** Constant GL_R11F_G11F_B10F */
    readonly R11F_G11F_B10F: GLenum;
    /** Constant GL_UNSIGNED_INT_10F_11F_11F_REV */
    readonly UNSIGNED_INT_10F_11F_11F_REV: GLenum;
    /** Constant GL_RGB9_E5 */
    readonly RGB9_E5: GLenum;
    /** Constant GL_UNSIGNED_INT_5_9_9_9_REV */
    readonly UNSIGNED_INT_5_9_9_9_REV: GLenum;
    /** Constant GL_TRANSFORM_FEEDBACK_BUFFER_MODE */
    readonly TRANSFORM_FEEDBACK_BUFFER_MODE: GLenum;
    /** Constant GL_MAX_TRANSFORM_FEEDBACK_SEPARATE_COMPONENTS */
    readonly MAX_TRANSFORM_FEEDBACK_SEPARATE_COMPONENTS: GLenum;
    /** Constant GL_TRANSFORM_FEEDBACK_VARYINGS */
    readonly TRANSFORM_FEEDBACK_VARYINGS: GLenum;
    /** Constant GL_TRANSFORM_FEEDBACK_BUFFER_START */
    readonly TRANSFORM_FEEDBACK_BUFFER_START: GLenum;
    /** Constant GL_TRANSFORM_FEEDBACK_BUFFER_SIZE */
    readonly TRANSFORM_FEEDBACK_BUFFER_SIZE: GLenum;
    /** Constant GL_TRANSFORM_FEEDBACK_PRIMITIVES_WRITTEN */
    readonly TRANSFORM_FEEDBACK_PRIMITIVES_WRITTEN: GLenum;
    /** Constant GL_RASTERIZER_DISCARD */
    readonly RASTERIZER_DISCARD: GLenum;
    /** Constant GL_MAX_TRANSFORM_FEEDBACK_INTERLEAVED_COMPONENTS */
    readonly MAX_TRANSFORM_FEEDBACK_INTERLEAVED_COMPONENTS: GLenum;
    /** Constant GL_MAX_TRANSFORM_FEEDBACK_SEPARATE_ATTRIBS */
    readonly MAX_TRANSFORM_FEEDBACK_SEPARATE_ATTRIBS: GLenum;
    /** Constant GL_INTERLEAVED_ATTRIBS */
    readonly INTERLEAVED_ATTRIBS: GLenum;
    /** Constant GL_SEPARATE_ATTRIBS */
    readonly SEPARATE_ATTRIBS: GLenum;
    /** Constant GL_TRANSFORM_FEEDBACK_BUFFER */
    readonly TRANSFORM_FEEDBACK_BUFFER: GLenum;
    /** Constant GL_TRANSFORM_FEEDBACK_BUFFER_BINDING */
    readonly TRANSFORM_FEEDBACK_BUFFER_BINDING: GLenum;
    /** Constant GL_RGBA32UI */
    readonly RGBA32UI: GLenum;
    /** Constant GL_RGB32UI */
    readonly RGB32UI: GLenum;
    /** Constant GL_RGBA16UI */
    readonly RGBA16UI: GLenum;
    /** Constant GL_RGB16UI */
    readonly RGB16UI: GLenum;
    /** Constant GL_RGBA8UI */
    readonly RGBA8UI: GLenum;
    /** Constant GL_RGB8UI */
    readonly RGB8UI: GLenum;
    /** Constant GL_RGBA32I */
    readonly RGBA32I: GLenum;
    /** Constant GL_RGB32I */
    readonly RGB32I: GLenum;
    /** Constant GL_RGBA16I */
    readonly RGBA16I: GLenum;
    /** Constant GL_RGB16I */
    readonly RGB16I: GLenum;
    /** Constant GL_RGBA8I */
    readonly RGBA8I: GLenum;
    /** Constant GL_RGB8I */
    readonly RGB8I: GLenum;
    /** Constant GL_RED_INTEGER */
    readonly RED_INTEGER: GLenum;
    /** Constant GL_RGB_INTEGER */
    readonly RGB_INTEGER: GLenum;
    /** Constant GL_RGBA_INTEGER */
    readonly RGBA_INTEGER: GLenum;
    /** Constant GL_SAMPLER_2D_ARRAY */
    readonly SAMPLER_2D_ARRAY: GLenum;
    /** Constant GL_SAMPLER_2D_ARRAY_SHADOW */
    readonly SAMPLER_2D_ARRAY_SHADOW: GLenum;
    /** Constant GL_SAMPLER_CUBE_SHADOW */
    readonly SAMPLER_CUBE_SHADOW: GLenum;
    /** Constant GL_UNSIGNED_INT_VEC2 */
    readonly UNSIGNED_INT_VEC2: GLenum;
    /** Constant GL_UNSIGNED_INT_VEC3 */
    readonly UNSIGNED_INT_VEC3: GLenum;
    /** Constant GL_UNSIGNED_INT_VEC4 */
    readonly UNSIGNED_INT_VEC4: GLenum;
    /** Constant GL_INT_SAMPLER_2D */
    readonly INT_SAMPLER_2D: GLenum;
    /** Constant GL_INT_SAMPLER_3D */
    readonly INT_SAMPLER_3D: GLenum;
    /** Constant GL_INT_SAMPLER_CUBE */
    readonly INT_SAMPLER_CUBE: GLenum;
    /** Constant GL_INT_SAMPLER_2D_ARRAY */
    readonly INT_SAMPLER_2D_ARRAY: GLenum;
    /** Constant GL_UNSIGNED_INT_SAMPLER_2D */
    readonly UNSIGNED_INT_SAMPLER_2D: GLenum;
    /** Constant GL_UNSIGNED_INT_SAMPLER_3D */
    readonly UNSIGNED_INT_SAMPLER_3D: GLenum;
    /** Constant GL_UNSIGNED_INT_SAMPLER_CUBE */
    readonly UNSIGNED_INT_SAMPLER_CUBE: GLenum;
    /** Constant GL_UNSIGNED_INT_SAMPLER_2D_ARRAY */
    readonly UNSIGNED_INT_SAMPLER_2D_ARRAY: GLenum;
    /** Constant GL_DEPTH_COMPONENT32F */
    readonly DEPTH_COMPONENT32F: GLenum;
    /** Constant GL_DEPTH32F_STENCIL8 */
    readonly DEPTH32F_STENCIL8: GLenum;
    /** Constant GL_FLOAT_32_UNSIGNED_INT_24_8_REV */
    readonly FLOAT_32_UNSIGNED_INT_24_8_REV: GLenum;
    /** Constant GL_FRAMEBUFFER_ATTACHMENT_COLOR_ENCODING */
    readonly FRAMEBUFFER_ATTACHMENT_COLOR_ENCODING: GLenum;
    /** Constant GL_FRAMEBUFFER_ATTACHMENT_COMPONENT_TYPE */
    readonly FRAMEBUFFER_ATTACHMENT_COMPONENT_TYPE: GLenum;
    /** Constant GL_FRAMEBUFFER_ATTACHMENT_RED_SIZE */
    readonly FRAMEBUFFER_ATTACHMENT_RED_SIZE: GLenum;
    /** Constant GL_FRAMEBUFFER_ATTACHMENT_GREEN_SIZE */
    readonly FRAMEBUFFER_ATTACHMENT_GREEN_SIZE: GLenum;
    /** Constant GL_FRAMEBUFFER_ATTACHMENT_BLUE_SIZE */
    readonly FRAMEBUFFER_ATTACHMENT_BLUE_SIZE: GLenum;
    /** Constant GL_FRAMEBUFFER_ATTACHMENT_ALPHA_SIZE */
    readonly FRAMEBUFFER_ATTACHMENT_ALPHA_SIZE: GLenum;
    /** Constant GL_FRAMEBUFFER_ATTACHMENT_DEPTH_SIZE */
    readonly FRAMEBUFFER_ATTACHMENT_DEPTH_SIZE: GLenum;
    /** Constant GL_FRAMEBUFFER_ATTACHMENT_STENCIL_SIZE */
    readonly FRAMEBUFFER_ATTACHMENT_STENCIL_SIZE: GLenum;
    /** Constant GL_FRAMEBUFFER_DEFAULT */
    readonly FRAMEBUFFER_DEFAULT: GLenum;
    /** Constant GL_UNSIGNED_INT_24_8 */
    readonly UNSIGNED_INT_24_8: GLenum;
    /** Constant GL_DEPTH24_STENCIL8 */
    readonly DEPTH24_STENCIL8: GLenum;
    /** Constant GL_UNSIGNED_NORMALIZED */
    readonly UNSIGNED_NORMALIZED: GLenum;
    /** Constant GL_DRAW_FRAMEBUFFER_BINDING */
    readonly DRAW_FRAMEBUFFER_BINDING: GLenum;
    /** Constant GL_READ_FRAMEBUFFER */
    readonly READ_FRAMEBUFFER: GLenum;
    /** Constant GL_DRAW_FRAMEBUFFER */
    readonly DRAW_FRAMEBUFFER: GLenum;
    /** Constant GL_READ_FRAMEBUFFER_BINDING */
    readonly READ_FRAMEBUFFER_BINDING: GLenum;
    /** Constant GL_RENDERBUFFER_SAMPLES */
    readonly RENDERBUFFER_SAMPLES: GLenum;
    /** Constant GL_FRAMEBUFFER_ATTACHMENT_TEXTURE_LAYER */
    readonly FRAMEBUFFER_ATTACHMENT_TEXTURE_LAYER: GLenum;
    /** Constant GL_MAX_COLOR_ATTACHMENTS */
    readonly MAX_COLOR_ATTACHMENTS: GLenum;
    /** Constant GL_COLOR_ATTACHMENT1 */
    readonly COLOR_ATTACHMENT1: GLenum;
    /** Constant GL_COLOR_ATTACHMENT2 */
    readonly COLOR_ATTACHMENT2: GLenum;
    /** Constant GL_COLOR_ATTACHMENT3 */
    readonly COLOR_ATTACHMENT3: GLenum;
    /** Constant GL_COLOR_ATTACHMENT4 */
    readonly COLOR_ATTACHMENT4: GLenum;
    /** Constant GL_COLOR_ATTACHMENT5 */
    readonly COLOR_ATTACHMENT5: GLenum;
    /** Constant GL_COLOR_ATTACHMENT6 */
    readonly COLOR_ATTACHMENT6: GLenum;
    /** Constant GL_COLOR_ATTACHMENT7 */
    readonly COLOR_ATTACHMENT7: GLenum;
    /** Constant GL_COLOR_ATTACHMENT8 */
    readonly COLOR_ATTACHMENT8: GLenum;
    /** Constant GL_COLOR_ATTACHMENT9 */
    readonly COLOR_ATTACHMENT9: GLenum;
    /** Constant GL_COLOR_ATTACHMENT10 */
    readonly COLOR_ATTACHMENT10: GLenum;
    /** Constant GL_COLOR_ATTACHMENT11 */
    readonly COLOR_ATTACHMENT11: GLenum;
    /** Constant GL_COLOR_ATTACHMENT12 */
    readonly COLOR_ATTACHMENT12: GLenum;
    /** Constant GL_COLOR_ATTACHMENT13 */
    readonly COLOR_ATTACHMENT13: GLenum;
    /** Constant GL_COLOR_ATTACHMENT14 */
    readonly COLOR_ATTACHMENT14: GLenum;
    /** Constant GL_COLOR_ATTACHMENT15 */
    readonly COLOR_ATTACHMENT15: GLenum;
    /** Constant GL_FRAMEBUFFER_INCOMPLETE_MULTISAMPLE */
    readonly FRAMEBUFFER_INCOMPLETE_MULTISAMPLE: GLenum;
    /** Constant GL_MAX_SAMPLES */
    readonly MAX_SAMPLES: GLenum;
    /** Constant GL_HALF_FLOAT */
    readonly HALF_FLOAT: GLenum;
    /** Constant GL_RG */
    readonly RG: GLenum;
    /** Constant GL_RG_INTEGER */
    readonly RG_INTEGER: GLenum;
    /** Constant GL_R8 */
    readonly R8: GLenum;
    /** Constant GL_RG8 */
    readonly RG8: GLenum;
    /** Constant GL_R16F */
    readonly R16F: GLenum;
    /** Constant GL_R32F */
    readonly R32F: GLenum;
    /** Constant GL_RG16F */
    readonly RG16F: GLenum;
    /** Constant GL_RG32F */
    readonly RG32F: GLenum;
    /** Constant GL_R8I */
    readonly R8I: GLenum;
    /** Constant GL_R8UI */
    readonly R8UI: GLenum;
    /** Constant GL_R16I */
    readonly R16I: GLenum;
    /** Constant GL_R16UI */
    readonly R16UI: GLenum;
    /** Constant GL_R32I */
    readonly R32I: GLenum;
    /** Constant GL_R32UI */
    readonly R32UI: GLenum;
    /** Constant GL_RG8I */
    readonly RG8I: GLenum;
    /** Constant GL_RG8UI */
    readonly RG8UI: GLenum;
    /** Constant GL_RG16I */
    readonly RG16I: GLenum;
    /** Constant GL_RG16UI */
    readonly RG16UI: GLenum;
    /** Constant GL_RG32I */
    readonly RG32I: GLenum;
    /** Constant GL_RG32UI */
    readonly RG32UI: GLenum;
    /** Constant GL_VERTEX_ARRAY_BINDING */
    readonly VERTEX_ARRAY_BINDING: GLenum;
    /** Constant GL_R8_SNORM */
    readonly R8_SNORM: GLenum;
    /** Constant GL_RG8_SNORM */
    readonly RG8_SNORM: GLenum;
    /** Constant GL_RGB8_SNORM */
    readonly RGB8_SNORM: GLenum;
    /** Constant GL_RGBA8_SNORM */
    readonly RGBA8_SNORM: GLenum;
    /** Constant GL_SIGNED_NORMALIZED */
    readonly SIGNED_NORMALIZED: GLenum;
    /** Constant GL_COPY_READ_BUFFER */
    readonly COPY_READ_BUFFER: GLenum;
    /** Constant GL_COPY_WRITE_BUFFER */
    readonly COPY_WRITE_BUFFER: GLenum;
    /** Constant GL_COPY_READ_BUFFER_BINDING */
    readonly COPY_READ_BUFFER_BINDING: GLenum;
    /** Constant GL_COPY_WRITE_BUFFER_BINDING */
    readonly COPY_WRITE_BUFFER_BINDING: GLenum;
    /** Constant GL_UNIFORM_BUFFER */
    readonly UNIFORM_BUFFER: GLenum;
    /** Constant GL_UNIFORM_BUFFER_BINDING */
    readonly UNIFORM_BUFFER_BINDING: GLenum;
    /** Constant GL_UNIFORM_BUFFER_START */
    readonly UNIFORM_BUFFER_START: GLenum;
    /** Constant GL_UNIFORM_BUFFER_SIZE */
    readonly UNIFORM_BUFFER_SIZE: GLenum;
    /** Constant GL_MAX_VERTEX_UNIFORM_BLOCKS */
    readonly MAX_VERTEX_UNIFORM_BLOCKS: GLenum;
    /** Constant GL_MAX_FRAGMENT_UNIFORM_BLOCKS */
    readonly MAX_FRAGMENT_UNIFORM_BLOCKS: GLenum;
    /** Constant GL_MAX_COMBINED_UNIFORM_BLOCKS */
    readonly MAX_COMBINED_UNIFORM_BLOCKS: GLenum;
    /** Constant GL_MAX_UNIFORM_BUFFER_BINDINGS */
    readonly MAX_UNIFORM_BUFFER_BINDINGS: GLenum;
    /** Constant GL_MAX_UNIFORM_BLOCK_SIZE */
    readonly MAX_UNIFORM_BLOCK_SIZE: GLenum;
    /** Constant GL_MAX_COMBINED_VERTEX_UNIFORM_COMPONENTS */
    readonly MAX_COMBINED_VERTEX_UNIFORM_COMPONENTS: GLenum;
    /** Constant GL_MAX_COMBINED_FRAGMENT_UNIFORM_COMPONENTS */
    readonly MAX_COMBINED_FRAGMENT_UNIFORM_COMPONENTS: GLenum;
    /** Constant GL_UNIFORM_BUFFER_OFFSET_ALIGNMENT */
    readonly UNIFORM_BUFFER_OFFSET_ALIGNMENT: GLenum;
    /** Constant GL_ACTIVE_UNIFORM_BLOCKS */
    readonly ACTIVE_UNIFORM_BLOCKS: GLenum;
    /** Constant GL_UNIFORM_TYPE */
    readonly UNIFORM_TYPE: GLenum;
    /** Constant GL_UNIFORM_SIZE */
    readonly UNIFORM_SIZE: GLenum;
    /** Constant GL_UNIFORM_BLOCK_INDEX */
    readonly UNIFORM_BLOCK_INDEX: GLenum;
    /** Constant GL_UNIFORM_OFFSET */
    readonly UNIFORM_OFFSET: GLenum;
    /** Constant GL_UNIFORM_ARRAY_STRIDE */
    readonly UNIFORM_ARRAY_STRIDE: GLenum;
    /** Constant GL_UNIFORM_MATRIX_STRIDE */
    readonly UNIFORM_MATRIX_STRIDE: GLenum;
    /** Constant GL_UNIFORM_IS_ROW_MAJOR */
    readonly UNIFORM_IS_ROW_MAJOR: GLenum;
    /** Constant GL_UNIFORM_BLOCK_BINDING */
    readonly UNIFORM_BLOCK_BINDING: GLenum;
    /** Constant GL_UNIFORM_BLOCK_DATA_SIZE */
    readonly UNIFORM_BLOCK_DATA_SIZE: GLenum;
    /** Constant GL_UNIFORM_BLOCK_ACTIVE_UNIFORMS */
    readonly UNIFORM_BLOCK_ACTIVE_UNIFORMS: GLenum;
    /** Constant GL_UNIFORM_BLOCK_ACTIVE_UNIFORM_INDICES */
    readonly UNIFORM_BLOCK_ACTIVE_UNIFORM_INDICES: GLenum;
    /** Constant GL_UNIFORM_BLOCK_REFERENCED_BY_VERTEX_SHADER */
    readonly UNIFORM_BLOCK_REFERENCED_BY_VERTEX_SHADER: GLenum;
    /** Constant GL_UNIFORM_BLOCK_REFERENCED_BY_FRAGMENT_SHADER */
    readonly UNIFORM_BLOCK_REFERENCED_BY_FRAGMENT_SHADER: GLenum;
    /** Constant GL_INVALID_INDEX */
    readonly INVALID_INDEX: GLenum;
    /** Constant GL_MAX_VERTEX_OUTPUT_COMPONENTS */
    readonly MAX_VERTEX_OUTPUT_COMPONENTS: GLenum;
    /** Constant GL_MAX_FRAGMENT_INPUT_COMPONENTS */
    readonly MAX_FRAGMENT_INPUT_COMPONENTS: GLenum;
    /** Constant GL_MAX_SERVER_WAIT_TIMEOUT */
    readonly MAX_SERVER_WAIT_TIMEOUT: GLenum;
    /** Constant GL_OBJECT_TYPE */
    readonly OBJECT_TYPE: GLenum;
    /** Constant GL_SYNC_CONDITION */
    readonly SYNC_CONDITION: GLenum;
    /** Constant GL_SYNC_STATUS */
    readonly SYNC_STATUS: GLenum;
    /** Constant GL_SYNC_FLAGS */
    readonly SYNC_FLAGS: GLenum;
    /** Constant GL_SYNC_FENCE */
    readonly SYNC_FENCE: GLenum;
    /** Constant GL_SYNC_GPU_COMMANDS_COMPLETE */
    readonly SYNC_GPU_COMMANDS_COMPLETE: GLenum;
    /** Constant GL_UNSIGNALED */
    readonly UNSIGNALED: GLenum;
    /** Constant GL_SIGNALED */
    readonly SIGNALED: GLenum;
    /** Constant GL_ALREADY_SIGNALED */
    readonly ALREADY_SIGNALED: GLenum;
    /** Constant GL_TIMEOUT_EXPIRED */
    readonly TIMEOUT_EXPIRED: GLenum;
    /** Constant GL_CONDITION_SATISFIED */
    readonly CONDITION_SATISFIED: GLenum;
    /** Constant GL_WAIT_FAILED */
    readonly WAIT_FAILED: GLenum;
    /** Constant GL_SYNC_FLUSH_COMMANDS_BIT */
    readonly SYNC_FLUSH_COMMANDS_BIT: GLenum;
    /** Constant GL_VERTEX_ATTRIB_ARRAY_DIVISOR */
    readonly VERTEX_ATTRIB_ARRAY_DIVISOR: GLenum;
    /** Constant GL_ANY_SAMPLES_PASSED */
    readonly ANY_SAMPLES_PASSED: GLenum;
    /** Constant GL_ANY_SAMPLES_PASSED_CONSERVATIVE */
    readonly ANY_SAMPLES_PASSED_CONSERVATIVE: GLenum;
    /** Constant GL_SAMPLER_BINDING */
    readonly SAMPLER_BINDING: GLenum;
    /** Constant GL_RGB10_A2UI */
    readonly RGB10_A2UI: GLenum;
    /** Constant GL_INT_2_10_10_10_REV */
    readonly INT_2_10_10_10_REV: GLenum;
    /** Constant GL_TRANSFORM_FEEDBACK */
    readonly TRANSFORM_FEEDBACK: GLenum;
    /** Constant GL_TRANSFORM_FEEDBACK_PAUSED */
    readonly TRANSFORM_FEEDBACK_PAUSED: GLenum;
    /** Constant GL_TRANSFORM_FEEDBACK_ACTIVE */
    readonly TRANSFORM_FEEDBACK_ACTIVE: GLenum;
    /** Constant GL_TRANSFORM_FEEDBACK_BINDING */
    readonly TRANSFORM_FEEDBACK_BINDING: GLenum;
    /** Constant GL_TEXTURE_IMMUTABLE_FORMAT */
    readonly TEXTURE_IMMUTABLE_FORMAT: GLenum;
    /** Constant GL_MAX_ELEMENT_INDEX */
    readonly MAX_ELEMENT_INDEX: GLenum;
    /** Constant GL_TEXTURE_IMMUTABLE_LEVELS */
    readonly TEXTURE_IMMUTABLE_LEVELS: GLenum;
    /** Constant GL_MAX_CLIENT_WAIT_TIMEOUT_WEBGL */
    readonly MAX_CLIENT_WAIT_TIMEOUT_WEBGL: GLenum;
    /** Constant TIMEOUT_IGNORED (-1; WebGL defines it as a GLint64) */
    readonly TIMEOUT_IGNORED: GLenum;
    /** Constant GL_STENCIL_INDEX8 (a real stencil format here, not the WebGL 1 alias of DEPTH_STENCIL) */
    readonly STENCIL_INDEX8: GLenum;
  }

  /**
   * The global WebGLRenderingContext / WebGL2RenderingContext (also on DesktopEngine), set up by the Canvas module polyfill.
   * Stand-in classes for `instanceof` and `gl.constructor.name` (the contexts are native objects); they hold no constants.
   * `instanceof` compares Object.prototype.toString tags, so a WebGL 2 context is not `instanceof WebGLRenderingContext`
   * (in browsers it is; TypeScript assumes it is).
   */
  interface WebGLContextConstructor<T> {
    /** Always throws TypeError('Illegal constructor') */
    new (): never;
    /** Checks `Object.prototype.toString.call(value)` against the class name */
    [Symbol.hasInstance](value: unknown): value is T;
  }

  // ---------------------------------------------------------------------------
  // Screen
  // ---------------------------------------------------------------------------

  /** Rectangle */
  interface Rect {
    /** x */
    x: number;
    /** y */
    y: number;
    /** Width */
    width: number;
    /** Height */
    height: number;
  }

  /** Size */
  interface Size {
    /** Width */
    width: number;
    /** Height */
    height: number;
  }

  /** Display information (each read of mainScreen/screens creates new objects) */
  interface Screen {
    /** Display ID (CGDirectDisplayID) */
    readonly identifier: number;
    /** Whether the display is active */
    readonly isActive: boolean;
    /** Whether the display is asleep */
    readonly isAsleep: boolean;
    /** Whether the display is online */
    readonly isOnline: boolean;
    /** Whether this is the main display */
    readonly isMain: boolean;
    /** Whether this is a built-in display */
    readonly isBuiltin: boolean;
    /** Whether the display is in a mirror set */
    readonly isInMirrorSet: boolean;
    /** Bounds in global coordinates (points, origin at the top-left of the main display) */
    readonly bounds: Rect;
    /** Resolution in pixels */
    readonly resolution: Size;
    /** Physical size (millimeters) */
    readonly physicalSize: Size;
  }

  /** Screen manager (DesktopEngine.ScreenManager is its singleton instance) */
  interface ScreenManager extends EventedObject<ScreenManagerEventMap> {
    /** The main display */
    readonly mainScreen: Screen;
    /** All online displays, sleeping ones too (`isAsleep`), without those mirroring another; the main display first */
    readonly screens: Screen[];
    /** change callback */
    onchange: EventHandler<this, void> | null | undefined;
    /** Removes the onchange callback */
    offchange(): void;
  }

  // ---------------------------------------------------------------------------
  // System
  // ---------------------------------------------------------------------------

  /** System services (DesktopEngine.system) */
  interface System extends EventedObject<SystemEventMap> {
    /** The current system appearance */
    readonly appearance: Appearance;
    /** appearancechange callback */
    onappearancechange: EventHandler<this, SystemEventMap['appearancechange']> | null | undefined;
    /** Removes the onappearancechange callback */
    offappearancechange(): void;
    /** Asks the runtime to run a garbage collection (asynchronously) */
    triggerGC(): void;
    /** CPU usage of the whole system since the previous call (0–1); the first call returns the average since boot. Needs the system-info permission, throws without it */
    cpuUsage(): number;
    /** Memory usage in bytes; used matches Memory Used in Activity Monitor. Needs the system-info permission, throws without it */
    memoryUsage(): { total: number; used: number; free: number };
  }

  // ---------------------------------------------------------------------------
  // File system (DesktopEngine.fs)
  // ---------------------------------------------------------------------------

  /**
   * A path of `DesktopEngine.fs`, taken literally (no percent-decoding):
   * - a file in the package, read-only: `data.json`, `./data.json` and `/data.json` all start at the package root
   * - `defile://usr/...`: the content's own files, kept between launches and shared by all its instances
   * - `defile://temp/...`: temporary files, deleted when the content stops
   *
   * `..` can't go above these roots.
   */
  type FilePath = string;

  /** Text encoding, as in Node */
  type FileEncoding = 'utf8' | 'utf-8' | 'ascii' | 'latin1' | 'binary' | 'base64' | 'base64url' | 'hex' | 'ucs2' | 'ucs-2' | 'utf16le' | 'utf-16le';

  /** Data to write: a string (UTF-8 unless an encoding is given), an ArrayBuffer or a view of one (typed array, DataView) */
  type FileData = string | ArrayBuffer | ArrayBufferView;

  /** Options of writeFile / appendFile, or the encoding itself */
  type WriteFileOptions = FileEncoding | { encoding?: FileEncoding | null };

  /** An error of `DesktopEngine.fs`, like Node's */
  interface FileSystemError extends Error {
    /** e.g. `'ENOENT'` (no such file), `'EEXIST'`, `'ENOTDIR'`, `'EISDIR'`, `'ENOTEMPTY'`, `'EACCES'` (read-only or outside of the sandbox), `'EINVAL'` (not a file path) */
    code: string;
    /** The operation that failed, e.g. `'open'` */
    syscall: string;
    /** The path as it was given */
    path: string;
  }

  /** What `stat` tells about a file or a directory */
  interface Stats {
    isFile(): boolean;
    isDirectory(): boolean;
    /** Always false: symbolic links are followed */
    isSymbolicLink(): boolean;
    /** Size in bytes */
    size: number;
    mode: number;
    /** Times in milliseconds since 1970 */
    atimeMs: number;
    mtimeMs: number;
    ctimeMs: number;
    birthtimeMs: number;
    atime: Date;
    mtime: Date;
    ctime: Date;
    birthtime: Date;
  }

  /**
   * The file system, `DesktopEngine.fs`: the functions of Node's `fs/promises` and their `Sync` versions. The asynchronous
   * ones run one at a time in order, off the JavaScript thread; they reject with a {@link FileSystemError}, the `Sync`
   * ones throw it. Binary data is an ArrayBuffer.
   *
   * ```js
   * const fs = DesktopEngine.fs;
   * await fs.mkdir('defile://usr/notes', { recursive: true });
   * await fs.writeFile('defile://usr/notes/today.json', JSON.stringify(note));
   * const text = await fs.readFile('defile://usr/notes/today.json', 'utf8');
   * ```
   */
  interface FileSystem {
    /** Reads a file: an ArrayBuffer, or a string with an encoding */
    readFile(path: FilePath, options?: null | { encoding?: null }): Promise<ArrayBuffer>;
    readFile(path: FilePath, options: FileEncoding | { encoding: FileEncoding }): Promise<string>;
    readFileSync(path: FilePath, options?: null | { encoding?: null }): ArrayBuffer;
    readFileSync(path: FilePath, options: FileEncoding | { encoding: FileEncoding }): string;
    /** Replaces the file (all at once: it's never left half written), making it when it doesn't exist; its directory must exist */
    writeFile(path: FilePath, data: FileData, options?: WriteFileOptions): Promise<void>;
    writeFileSync(path: FilePath, data: FileData, options?: WriteFileOptions): void;
    /** Adds to the end of the file, making it when it doesn't exist */
    appendFile(path: FilePath, data: FileData, options?: WriteFileOptions): Promise<void>;
    appendFileSync(path: FilePath, data: FileData, options?: WriteFileOptions): void;
    /** Makes a directory; with `recursive` also its missing parents, and it's no error when it exists */
    mkdir(path: FilePath, options?: { recursive?: boolean }): Promise<void>;
    mkdirSync(path: FilePath, options?: { recursive?: boolean }): void;
    /** The names in a directory, sorted */
    readdir(path: FilePath): Promise<string[]>;
    readdirSync(path: FilePath): string[];
    stat(path: FilePath): Promise<Stats>;
    statSync(path: FilePath): Stats;
    /** Resolves when the file or directory exists, rejects with ENOENT otherwise */
    access(path: FilePath): Promise<void>;
    accessSync(path: FilePath): void;
    /** Whether the file or directory exists */
    existsSync(path: FilePath): boolean;
    /** Removes a file, or a directory with `recursive`; `force` ignores a missing one */
    rm(path: FilePath, options?: { recursive?: boolean; force?: boolean }): Promise<void>;
    rmSync(path: FilePath, options?: { recursive?: boolean; force?: boolean }): void;
    /** Removes an empty directory */
    rmdir(path: FilePath): Promise<void>;
    rmdirSync(path: FilePath): void;
    /** Removes a file */
    unlink(path: FilePath): Promise<void>;
    unlinkSync(path: FilePath): void;
    /** Moves or renames a file or a directory, replacing a file at the new path */
    rename(oldPath: FilePath, newPath: FilePath): Promise<void>;
    renameSync(oldPath: FilePath, newPath: FilePath): void;
    /** Copies a file, replacing the destination */
    copyFile(src: FilePath, dest: FilePath): Promise<void>;
    copyFileSync(src: FilePath, dest: FilePath): void;
    /** The class of what `stat` returns, for instanceof */
    readonly Stats: IllegalConstructor<Stats>;
  }

  // ---------------------------------------------------------------------------
  // CommonJS
  // ---------------------------------------------------------------------------

  /** The require function: resolves relative to the current module's directory; `.js` may be omitted and `.json` is supported; like Node, a missing file throws an Error with code "MODULE_NOT_FOUND" */
  interface RequireFunction {
    /** Loads a module and returns its exports */
    (moduleId: string): any;
  }

  /** A CommonJS module object */
  interface Module {
    /** Module ID (absolute path without .js) */
    id: string;
    /** File path */
    filePath: string;
    /** File extension */
    ext: 'js' | 'json';
    /** Exports object */
    exports: any;
    /** Whether the module has loaded */
    loaded: boolean;
    /** Containing directory */
    dirPath: string;
    /** Loads the module contents */
    load(): any;
    /** Loads another module relative to this one */
    require(moduleId: string): any;
  }

  // ---------------------------------------------------------------------------
  // Internal constructors
  // ---------------------------------------------------------------------------

  /** Native Utils object (its methods are mixed into DesktopEngine) */
  interface Utils {
    /** Calls a constructor with an argument array: `new ctor(...args)`; returns null unless there are exactly 2 arguments, throws a TypeError if `constructor` isn't one or `args` isn't an object */
    applyNew<T>(constructor: new (...args: any[]) => T, args: ArrayLike<any>): T;
    /** Runs a callback after a delay, see the global setTimeout */
    setTimeout<A extends any[]>(callback: (...args: A) => void, delay?: number, ...args: A): number;
    /** Runs a callback repeatedly, see the global setInterval */
    setInterval<A extends any[]>(callback: (...args: A) => void, delay?: number, ...args: A): number;
    /** Cancels a setTimeout */
    clearTimeout(id: number | null | undefined): void;
    /** Cancels a setInterval */
    clearInterval(id: number | null | undefined): void;
    /** Encodes an ArrayBuffer (TypedArrays aren't supported) as Base64; returns null on failure */
    base64Encode(buffer: ArrayBuffer): string | null;
    /** Decodes a Base64 string into an ArrayBuffer; returns null on failure or if empty */
    base64Decode(base64: string): ArrayBuffer | null;
  }

  /** The global performance (a singleton, already created by the engine) */
  interface Performance {
    /**
     * Milliseconds since timeOrigin, with sub-millisecond precision, on a monotonic clock that stops while the Mac sleeps.
     * requestAnimationFrame callbacks get times on the same clock.
     */
    now(): number;
    /** When the mini program's JavaScript context was created, in milliseconds since 1970 */
    readonly timeOrigin: number;
  }

  /** Animation frame manager (a singleton, already created by the engine, which exports requestAnimationFrame) */
  interface AnimationFrameManager {
    /** See the global requestAnimationFrame */
    requestAnimationFrame(callback: FrameRequestCallback): number;
    /** See the global cancelAnimationFrame */
    cancelAnimationFrame(id: number): void;
  }

  /** Animation frame callback; the argument is the frame's time on the performance.now() clock, the same for every callback of a frame */
  type FrameRequestCallback = (time: number) => void;

  /** Singleton constructor (can be obtained only once per context) */
  interface SingletonConstructor<T> {
    /** Creates an instance */
    new (): T;
  }

  /** A plain constructor with no arguments */
  interface PlainConstructor<T> {
    /** Creates an instance */
    new (): T;
  }

  /** A global class for instanceof, which scripts can't construct */
  interface IllegalConstructor<T> {
    readonly prototype: T;
    /** Always throws TypeError('Illegal constructor') */
    new (): never;
  }

  /** The global DesktopEngine object */
  interface DesktopEngineStatic extends Utils {
    /** Window constructor */
    Window: WindowConstructor;
    /** Basic component constructor */
    Component: ComponentConstructor;
    /** Video component constructor */
    Video: VideoConstructor;
    /** Image component constructor */
    Image: ImageConstructor;
    /** Canvas component constructor */
    Canvas: CanvasConstructor;
    /** Canvas image constructor */
    CanvasImage: CanvasImageConstructor;
    /** Same as the global WebGLRenderingContext */
    WebGLRenderingContext: WebGLContextConstructor<WebGLRenderingContext>;
    /** Same as the global WebGL2RenderingContext */
    WebGL2RenderingContext: WebGLContextConstructor<WebGL2RenderingContext>;
    /** Screen manager instance (note: capitalized, but not a constructor) */
    ScreenManager: ScreenManager;
    /** System services instance */
    system: System;
    /** The file system: package files, and the content's own files that are kept between launches */
    readonly fs: FileSystem;
    /**
     * Read-only options passed in by the app at launch (size, display, position, user settings, etc.), injected before index.js runs.
     * Provided when the DesktopEngine app launches the content; `desktopengine dev` simulates them from its command-line arguments; {} when loaded directly from the Develop menu.
     */
    readonly launchOptions: Readonly<LaunchOptions>;
    /**
     * Runtime API version, incremented when APIs are added. If you need a newer API, declare `apiVersion` in manifest.json;
     * the app refuses to import the content when it has an older API. You can also check it at runtime and fall back.
     */
    readonly apiVersion: number;
    /**
     * The frame rate the content wants, e.g. 30 for slow scenery; 0 (the default) follows the display. Frames it skips
     * don't run at all, which saves more power than skipping them in a requestAnimationFrame callback: the thread isn't
     * even woken. Applies when the display's refresh rate is a multiple of it (60 Hz: 60, 30, 20, 15, 12…), otherwise
     * every frame runs. The app's own limit (e.g. 30 fps on battery) still applies, the lower one wins. Can change at any
     * time.
     */
    preferredFramesPerSecond: number;
  }

  /** Core scope DesktopEngineCore (each class name can be obtained only once; Utils is already taken by the engine) */
  interface CoreScope {
    /** Utils singleton constructor (internal) */
    readonly Utils: SingletonConstructor<Utils> | undefined;
    /** Performance singleton constructor (internal, use the global performance) */
    readonly Performance: SingletonConstructor<Performance> | undefined;
  }

  /** Runtime scope DesktopEngineRuntime: every property read returns a new constructor object */
  interface RuntimeScope {
    /** Animation frame manager (a singleton, internal) */
    readonly AnimationFrameManager: SingletonConstructor<AnimationFrameManager> | undefined;
    /** Window constructor */
    readonly Window: WindowConstructor;
    /** Basic component constructor */
    readonly Component: ComponentConstructor;
    /** Video component constructor */
    readonly Video: VideoConstructor;
    /** Image component constructor */
    readonly Image: ImageConstructor;
    /** Canvas component constructor */
    readonly Canvas: CanvasConstructor;
    /** Canvas image constructor */
    readonly CanvasImage: CanvasImageConstructor;
    /** Screen manager constructor */
    readonly ScreenManager: PlainConstructor<ScreenManager>;
    /** System services constructor */
    readonly System: PlainConstructor<System>;
    /** Native side of `DesktopEngine.fs` and `require` (internal: use `DesktopEngine.fs`) */
    readonly FileSystem: PlainConstructor<unknown>;
    /** Native side of `localStorage` (a singleton, internal: use the global) */
    readonly LocalStorage: SingletonConstructor<unknown> | undefined;
    /** Native side of fetch, WebSocket, blob URLs and TextDecoder (a singleton, internal: use the globals) */
    readonly Network: SingletonConstructor<unknown> | undefined;
    /** Native side of Web Audio and `Audio` (a singleton, internal: use the globals) */
    readonly Audio: SingletonConstructor<unknown> | undefined;
  }

  // ---------------------------------------------------------------------------
  // Events (the global Event class; MessageEvent, CloseEvent and ProgressEvent are globals too)
  // ---------------------------------------------------------------------------

  /** An event, same as the global Event; events don't bubble, target and currentTarget are the same */
  interface Event {
    readonly type: string;
    readonly target: unknown;
    readonly currentTarget: unknown;
    /** Always false */
    readonly bubbles: boolean;
    readonly cancelable: boolean;
    /** performance.now() when the event was created */
    readonly timeStamp: number;
    readonly defaultPrevented: boolean;
    preventDefault(): void;
    stopPropagation(): void;
    /** The listeners after this one aren't called */
    stopImmediatePropagation(): void;
  }

  /** A WebSocket message: a string for text messages, a Blob or an ArrayBuffer (see binaryType) for binary ones */
  interface MessageEvent extends Event {
    readonly data: any;
    /** ws(s)://host[:port] of the connection */
    readonly origin: string;
  }

  /** The WebSocket connection closed */
  interface CloseEvent extends Event {
    /** The close code, 1006 when the connection was lost or failed */
    readonly code: number;
    readonly reason: string;
    /** Whether the closing handshake completed */
    readonly wasClean: boolean;
  }

  /** The WebSocket connection failed; always followed by a close event */
  interface WebSocketErrorEvent extends Event {
    /** Why it failed (not in browsers, which hide the reason) */
    readonly message: string;
  }

  interface WebSocketEventMap {
    open: Event;
    message: MessageEvent;
    error: WebSocketErrorEvent;
    close: CloseEvent;
  }

  interface AbortSignalEventMap {
    abort: Event;
  }

  /** Progress of an XMLHttpRequest */
  interface ProgressEvent extends Event {
    /** Whether total is known (the response has a Content-Length) */
    readonly lengthComputable: boolean;
    /** Bytes of the response body received so far */
    readonly loaded: number;
    /** Bytes of the whole body, 0 when unknown */
    readonly total: number;
  }

  interface XMLHttpRequestEventMap {
    readystatechange: Event;
    loadstart: ProgressEvent;
    progress: ProgressEvent;
    abort: ProgressEvent;
    error: ProgressEvent;
    load: ProgressEvent;
    timeout: ProgressEvent;
    loadend: ProgressEvent;
  }

  interface AudioScheduledSourceNodeEventMap {
    ended: Event;
  }

  interface BaseAudioContextEventMap {
    statechange: Event;
  }

  interface OfflineAudioContextEventMap extends BaseAudioContextEventMap {
    complete: OfflineAudioCompletionEvent;
  }

  interface HTMLMediaElementEventMap {
    abort: Event; canplay: Event; canplaythrough: Event; durationchange: Event; emptied: Event; ended: Event;
    error: Event; loadeddata: Event; loadedmetadata: Event; loadstart: Event; pause: Event; play: Event;
    playing: Event; progress: Event; ratechange: Event; seeked: Event; seeking: Event; stalled: Event;
    suspend: Event; timeupdate: Event; volumechange: Event; waiting: Event;
  }

  interface AddEventListenerOptions {
    /** Removes the listener after the first call */
    once?: boolean;
    /** Removes the listener when the signal aborts */
    signal?: AbortSignal;
  }

  /** A listener object: handleEvent(event) is called */
  interface EventListenerObject {
    handleEvent(event: Event): void;
  }

  type EventListenerOrEventListenerObject = ((event: Event) => void) | EventListenerObject;

  /** addEventListener / removeEventListener / dispatchEvent with typed events */
  interface EventTarget<EventMap> {
    addEventListener<K extends keyof EventMap>(type: K, listener: (this: this, event: EventMap[K]) => void, options?: AddEventListenerOptions): void;
    removeEventListener<K extends keyof EventMap>(type: K, listener: (this: this, event: EventMap[K]) => void): void;
    /** Returns false when a listener called preventDefault() on a cancelable event */
    dispatchEvent(event: Event): boolean;
  }

  /** Console (built into JavaScriptCore; the engine also logs through it) */
  interface Console {
    /** Logs a message */
    log(...data: any[]): void;
    /** Logs an informational message */
    info(...data: any[]): void;
    /** Logs a warning */
    warn(...data: any[]): void;
    /** Logs an error (uncaught exceptions are also reported through it) */
    error(...data: any[]): void;
    /**
     * Logs a debug message
     * @remarks Unconfirmed: a JavaScriptCore built-in that the engine doesn't use explicitly
     */
    debug(...data: any[]): void;
    /**
     * Asserts a condition
     * @remarks Unconfirmed: a JavaScriptCore built-in that the engine doesn't use explicitly
     */
    assert(condition?: boolean, ...data: any[]): void;
    /**
     * Logs the call stack
     * @remarks Unconfirmed: a JavaScriptCore built-in that the engine doesn't use explicitly
     */
    trace(...data: any[]): void;
    /**
     * Starts a timer
     * @remarks Unconfirmed: a JavaScriptCore built-in that the engine doesn't use explicitly
     */
    time(label?: string): void;
    /**
     * Stops a timer
     * @remarks Unconfirmed: a JavaScriptCore built-in that the engine doesn't use explicitly
     */
    timeEnd(label?: string): void;
  }
}

// -----------------------------------------------------------------------------
// Global variables / functions
// -----------------------------------------------------------------------------

/** The main entry object for mini programs: Utils methods plus each module's constructors and instances */
declare var DesktopEngine: DesktopEngine.DesktopEngineStatic;

/** Core native class loading scope (internal) */
declare const DesktopEngineCore: DesktopEngine.CoreScope;

/** Runtime native class loading scope (DesktopEngine.* is taken from here) */
declare const DesktopEngineRuntime: DesktopEngine.RuntimeScope;

/** Console */
declare var console: DesktopEngine.Console;

/** Stand-in class of WebGL 1 contexts, for `gl instanceof WebGLRenderingContext`; can't be constructed */
declare var WebGLRenderingContext: DesktopEngine.WebGLContextConstructor<DesktopEngine.WebGLRenderingContext>;
/** Stand-in class of WebGL 2 contexts, for `gl instanceof WebGL2RenderingContext`; can't be constructed */
declare var WebGL2RenderingContext: DesktopEngine.WebGLContextConstructor<DesktopEngine.WebGL2RenderingContext>;

/**
 * Runs a callback after a delay in milliseconds, 0 by default, with the arguments after the delay. Like in browsers the
 * delay is converted to a number, and NaN or a negative one is 0. Returns the id for clearTimeout, which is never 0.
 */
declare function setTimeout<A extends any[]>(callback: (...args: A) => void, delay?: number, ...args: A): number;
/** Cancels a delayed callback */
declare function clearTimeout(id: number | null | undefined): void;
/**
 * Runs a callback repeatedly, every `delay` milliseconds but at least 4, with the arguments after the delay. The delay
 * is converted like setTimeout's. Returns the id for clearInterval, which is never 0.
 */
declare function setInterval<A extends any[]>(callback: (...args: A) => void, delay?: number, ...args: A): number;
/** Cancels a repeating callback */
declare function clearInterval(id: number | null | undefined): void;

/**
 * Calls back on the next rendered frame with the frame's time on the performance.now() clock; pass the returned ID to cancelAnimationFrame to cancel.
 * Not called while the app pauses content (on battery power, while a full-screen app is active, or while the display sleeps).
 */
declare function requestAnimationFrame(callback: DesktopEngine.FrameRequestCallback): number;
/** Cancels an animation frame that hasn't run yet */
declare function cancelAnimationFrame(id: number): void;

/** High resolution time: performance.now() and performance.timeOrigin */
declare var performance: DesktopEngine.Performance;

// -----------------------------------------------------------------------------
// Events and errors: DOMException, Event and EventTarget, shared by fetch, WebSocket and audio
// -----------------------------------------------------------------------------

/** Errors such as "AbortError", "TimeoutError", "SyntaxError" or "SecurityError", told apart by name */
interface DOMException extends Error {
  readonly name: string;
  /** Legacy error code, e.g. 20 for "AbortError" */
  readonly code: number;
}
declare var DOMException: {
  prototype: DOMException;
  new (message?: string, name?: string): DOMException;
};

interface EventInit {
  /** Ignored: events don't bubble */
  bubbles?: boolean;
  cancelable?: boolean;
}

interface Event extends DesktopEngine.Event {}
declare var Event: {
  prototype: Event;
  new (type: string, eventInitDict?: EventInit): Event;
};

/**
 * Listeners of an event type are called in the order they were added, after the `on<type>` handler; a listener that
 * throws is reported like an uncaught exception without stopping the others
 */
interface EventTarget {
  /** A boolean `options` (capture) is ignored */
  addEventListener(type: string, listener: DesktopEngine.EventListenerOrEventListenerObject | null, options?: DesktopEngine.AddEventListenerOptions | boolean): void;
  removeEventListener(type: string, listener: DesktopEngine.EventListenerOrEventListenerObject | null): void;
  /** Returns false when a listener called preventDefault() on a cancelable event */
  dispatchEvent(event: Event): boolean;
}
declare var EventTarget: {
  prototype: EventTarget;
  new (): EventTarget;
};

// -----------------------------------------------------------------------------
// Network: fetch, XMLHttpRequest and WebSocket
//
// http(s) and ws(s) URLs need the "network" permission in manifest.json: without it fetch rejects with a TypeError,
// XMLHttpRequest fires error and new WebSocket throws a "SecurityError" DOMException. Relative URLs ("data.json",
// "./data.json", "/data.json") and defile:// read files like require, without the permission; a missing file is a
// 404 response. data: and blob: URLs work too. Unlike browsers there's no CORS, and cookies are kept per mini program
// in memory. URLs are parsed like in browsers, percent-encoded and with "." and ".." resolved; a relative one stays
// relative to the package's root, so the url of new Request("./my data.json") is "my%20data.json".
// -----------------------------------------------------------------------------

type HeadersInit = [string, string][] | Record<string, string> | Headers;
/**
 * Strings are sent as UTF-8 (Content-Type text/plain;charset=UTF-8 unless set); Blob, FormData (multipart/form-data)
 * and URLSearchParams set their Content-Type too. A ReadableStream is read to the end before the request is sent.
 */
type BodyInit = string | ArrayBuffer | ArrayBufferView | Blob | FormData | URLSearchParams | ReadableStream<Uint8Array>;
type RequestInfo = Request | string;
type RequestRedirect = 'follow' | 'error' | 'manual';
type RequestCache = 'default' | 'no-store' | 'reload' | 'no-cache' | 'force-cache' | 'only-if-cached';

/** HTTP headers, names are case-insensitive */
interface Headers {
  append(name: string, value: string): void;
  delete(name: string): void;
  /** Values of the header joined with ", ", null when it's missing */
  get(name: string): string | null;
  getSetCookie(): string[];
  has(name: string): boolean;
  set(name: string, value: string): void;
  forEach(callback: (value: string, name: string, headers: Headers) => void, thisArg?: unknown): void;
  /** Lowercased names, sorted */
  entries(): IterableIterator<[string, string]>;
  keys(): IterableIterator<string>;
  values(): IterableIterator<string>;
  [Symbol.iterator](): IterableIterator<[string, string]>;
}
declare var Headers: {
  prototype: Headers;
  new (init?: HeadersInit): Headers;
};

/** Reading a request or response body, once */
interface Body {
  /** The body as a stream of bytes, null when there's none */
  readonly body: ReadableStream<Uint8Array> | null;
  /** The body has been read, or its stream read from or cancelled */
  readonly bodyUsed: boolean;
  arrayBuffer(): Promise<ArrayBuffer>;
  bytes(): Promise<Uint8Array>;
  /** Decoded as UTF-8, like browsers, whatever the charset */
  text(): Promise<string>;
  json(): Promise<any>;
  /** A Blob whose type is the Content-Type */
  blob(): Promise<Blob>;
  /** Parses a multipart/form-data or application/x-www-form-urlencoded body */
  formData(): Promise<FormData>;
}

interface RequestInit {
  /** GET by default */
  method?: string;
  headers?: HeadersInit;
  /** Not allowed for GET and HEAD */
  body?: BodyInit | null;
  /** Needed with a ReadableStream body, like in browsers */
  duplex?: 'half';
  /** Aborting rejects fetch with signal.reason (an "AbortError" DOMException by default), or errors the body stream */
  signal?: AbortSignal | null;
  /** "follow" by default; "manual" resolves with the redirect response itself (3xx with a Location header) */
  redirect?: RequestRedirect;
  cache?: RequestCache;
  /** Accepted for compatibility, ignored */
  credentials?: string;
  /** Accepted for compatibility, ignored */
  mode?: string;
}

interface Request extends Body {
  readonly url: string;
  readonly method: string;
  readonly headers: Headers;
  readonly signal: AbortSignal;
  readonly redirect: RequestRedirect;
  readonly cache: RequestCache;
  readonly duplex: 'half';
  clone(): Request;
}
declare var Request: {
  prototype: Request;
  new (input: RequestInfo | URL, init?: RequestInit): Request;
};

interface ResponseInit {
  /** 200 by default */
  status?: number;
  statusText?: string;
  headers?: HeadersInit;
}

interface Response extends Body {
  /** "basic" for responses of fetch */
  readonly type: 'basic' | 'default' | 'error';
  /** The final URL, after redirects */
  readonly url: string;
  readonly redirected: boolean;
  readonly status: number;
  /** status is 200-299 */
  readonly ok: boolean;
  readonly statusText: string;
  readonly headers: Headers;
  /** A copy; a streamed body is split in two (tee) */
  clone(): Response;
}
declare var Response: {
  prototype: Response;
  new (body?: BodyInit | null, init?: ResponseInit): Response;
  error(): Response;
  redirect(url: string, status?: number): Response;
  json(data: unknown, init?: ResponseInit): Response;
};

/**
 * Fetches a URL or a package file. Resolves once the headers have arrived, also for 4xx / 5xx statuses, and the body
 * follows as a stream. The download pauses while about 1 MB is waiting to be read. Rejects with a TypeError when the
 * request can't be made (no network permission, unreachable host, ...).
 * @remarks The system buffers the first 512 bytes of a text/plain response (content sniffing) before it's delivered:
 * streamed text, like server-sent events, should use another Content-Type such as text/event-stream.
 */
declare function fetch(input: RequestInfo | URL | { toString(): string }, init?: RequestInit): Promise<Response>;

interface AbortSignal extends DesktopEngine.EventTarget<DesktopEngine.AbortSignalEventMap> {
  readonly aborted: boolean;
  readonly reason: any;
  onabort: ((this: AbortSignal, event: DesktopEngine.Event) => void) | null;
  /** Throws reason when aborted */
  throwIfAborted(): void;
}
declare var AbortSignal: {
  prototype: AbortSignal;
  /** An already aborted signal */
  abort(reason?: unknown): AbortSignal;
  /** Aborts with a "TimeoutError" DOMException after the delay */
  timeout(milliseconds: number): AbortSignal;
  /** Aborts when any of the signals does */
  any(signals: Iterable<AbortSignal>): AbortSignal;
};

interface AbortController {
  readonly signal: AbortSignal;
  abort(reason?: unknown): void;
}
declare var AbortController: {
  prototype: AbortController;
  new (): AbortController;
};

/** More event classes, e.g. to dispatch events or to check instanceof */
declare var MessageEvent: {
  prototype: DesktopEngine.MessageEvent;
  new (type: string, init?: EventInit & { data?: unknown; origin?: string }): DesktopEngine.MessageEvent;
};
declare var CloseEvent: {
  prototype: DesktopEngine.CloseEvent;
  new (type: string, init?: EventInit & { code?: number; reason?: string; wasClean?: boolean }): DesktopEngine.CloseEvent;
};
declare var ProgressEvent: {
  prototype: DesktopEngine.ProgressEvent;
  new (type: string, init?: EventInit & { lengthComputable?: boolean; loaded?: number; total?: number }): DesktopEngine.ProgressEvent;
};

/** A WebSocket connection */
interface WebSocket extends DesktopEngine.EventTarget<DesktopEngine.WebSocketEventMap> {
  /** The URL, with http(s) turned into ws(s) */
  readonly url: string;
  /** WebSocket.CONNECTING, OPEN, CLOSING or CLOSED */
  readonly readyState: 0 | 1 | 2 | 3;
  /** The subprotocol the server picked */
  readonly protocol: string;
  readonly extensions: string;
  /** Bytes passed to send() that haven't been sent yet */
  readonly bufferedAmount: number;
  /** What binary messages are: "blob" (the default, like browsers) or "arraybuffer"; other values are ignored */
  binaryType: 'blob' | 'arraybuffer';
  onopen: ((this: WebSocket, event: DesktopEngine.Event) => void) | null;
  onmessage: ((this: WebSocket, event: DesktopEngine.MessageEvent) => void) | null;
  onerror: ((this: WebSocket, event: DesktopEngine.WebSocketErrorEvent) => void) | null;
  onclose: ((this: WebSocket, event: DesktopEngine.CloseEvent) => void) | null;
  /** Sends a text or binary message; throws an "InvalidStateError" DOMException while connecting, dropped once closing */
  send(data: string | ArrayBuffer | ArrayBufferView | Blob): void;
  /** code is 1000 (the default) or 3000-4999, reason at most 123 bytes of UTF-8 */
  close(code?: number, reason?: string): void;
  readonly CONNECTING: 0;
  readonly OPEN: 1;
  readonly CLOSING: 2;
  readonly CLOSED: 3;
}
declare var WebSocket: {
  prototype: WebSocket;
  /**
   * Connects to a ws(s) (or http(s)) URL. Throws a "SyntaxError" DOMException for a bad URL or subprotocols and
   * a "SecurityError" one without the network permission; connection failures are error + close events instead
   */
  new (url: string | URL | { toString(): string }, protocols?: string | string[]): WebSocket;
  readonly CONNECTING: 0;
  readonly OPEN: 1;
  readonly CLOSING: 2;
  readonly CLOSED: 3;
};

type XMLHttpRequestResponseType = '' | 'arraybuffer' | 'blob' | 'document' | 'json' | 'text';

/** Where XMLHttpRequest's progress events come from */
interface XMLHttpRequestEventTarget extends DesktopEngine.EventTarget<DesktopEngine.XMLHttpRequestEventMap> {
  onloadstart: ((this: this, event: DesktopEngine.ProgressEvent) => void) | null;
  onprogress: ((this: this, event: DesktopEngine.ProgressEvent) => void) | null;
  onabort: ((this: this, event: DesktopEngine.ProgressEvent) => void) | null;
  onerror: ((this: this, event: DesktopEngine.ProgressEvent) => void) | null;
  onload: ((this: this, event: DesktopEngine.ProgressEvent) => void) | null;
  ontimeout: ((this: this, event: DesktopEngine.ProgressEvent) => void) | null;
  onloadend: ((this: this, event: DesktopEngine.ProgressEvent) => void) | null;
}
declare var XMLHttpRequestEventTarget: {
  prototype: XMLHttpRequestEventTarget;
};

/** XMLHttpRequest.upload: never fires events */
interface XMLHttpRequestUpload extends XMLHttpRequestEventTarget {}
declare var XMLHttpRequestUpload: {
  prototype: XMLHttpRequestUpload;
};

/**
 * XMLHttpRequest, for libraries that use it; on top of fetch, with the same URLs and rules. Asynchronous only.
 */
interface XMLHttpRequest extends XMLHttpRequestEventTarget {
  /** UNSENT, OPENED, HEADERS_RECEIVED, LOADING or DONE */
  readonly readyState: 0 | 1 | 2 | 3 | 4;
  onreadystatechange: ((this: XMLHttpRequest, event: DesktopEngine.Event) => void) | null;
  /** 0 before the response or when the request failed */
  readonly status: number;
  readonly statusText: string;
  readonly responseURL: string;
  /** What response is; "document" isn't supported, its response is null */
  responseType: XMLHttpRequestResponseType;
  /**
   * The body as responseType asks: the text (decoded with the response's charset, UTF-8 by default), an ArrayBuffer,
   * a Blob or the parsed JSON (null when it isn't JSON); null until the request is done, but the text while loading
   */
  readonly response: any;
  /** The text so far; throws an "InvalidStateError" DOMException unless responseType is "" or "text" */
  readonly responseText: string;
  /** Always null: there are no documents */
  readonly responseXML: null;
  /** Milliseconds before the request fails with a timeout event, 0 (the default) for none */
  timeout: number;
  /** Accepted for compatibility: cookies are always sent */
  withCredentials: boolean;
  readonly upload: XMLHttpRequestUpload;
  /** async must be true: synchronous requests throw an "InvalidAccessError" DOMException */
  open(method: string, url: string | URL, async?: boolean, username?: string | null, password?: string | null): void;
  setRequestHeader(name: string, value: string): void;
  /** The MIME type (and charset) the response is read with */
  overrideMimeType(mime: string): void;
  /** Sends the request; the body is ignored for GET and HEAD */
  send(body?: BodyInit | null): void;
  /** Cancels the request: abort and loadend events, then readyState is UNSENT */
  abort(): void;
  getResponseHeader(name: string): string | null;
  /** "name: value\r\n" for each header, lowercased names, sorted */
  getAllResponseHeaders(): string;
  readonly UNSENT: 0;
  readonly OPENED: 1;
  readonly HEADERS_RECEIVED: 2;
  readonly LOADING: 3;
  readonly DONE: 4;
}
declare var XMLHttpRequest: {
  prototype: XMLHttpRequest;
  new (): XMLHttpRequest;
  readonly UNSENT: 0;
  readonly OPENED: 1;
  readonly HEADERS_RECEIVED: 2;
  readonly LOADING: 3;
  readonly DONE: 4;
};

// -----------------------------------------------------------------------------
// Data: Blob, File, FormData, URL, URLSearchParams, TextEncoder and TextDecoder
// -----------------------------------------------------------------------------

type BlobPart = string | ArrayBuffer | ArrayBufferView | Blob;

interface BlobPropertyBag {
  /** MIME type, lowercased; not printable ASCII is no type */
  type?: string;
  /** "native" turns \r\n and \r in strings into \n */
  endings?: 'transparent' | 'native';
}

/** Immutable bytes with a MIME type */
interface Blob {
  readonly size: number;
  readonly type: string;
  /** Part of the bytes, without copying them; negative indexes count from the end */
  slice(start?: number, end?: number, contentType?: string): Blob;
  arrayBuffer(): Promise<ArrayBuffer>;
  bytes(): Promise<Uint8Array>;
  /** Decoded as UTF-8 */
  text(): Promise<string>;
  stream(): ReadableStream<Uint8Array>;
}
declare var Blob: {
  prototype: Blob;
  /** Strings are encoded as UTF-8; the bytes are copied */
  new (blobParts?: Iterable<BlobPart>, options?: BlobPropertyBag): Blob;
};

interface FilePropertyBag extends BlobPropertyBag {
  /** Date.now() by default */
  lastModified?: number;
}

/** A Blob with a name, e.g. for FormData */
interface File extends Blob {
  readonly name: string;
  readonly lastModified: number;
  readonly webkitRelativePath: string;
}
declare var File: {
  prototype: File;
  new (fileBits: Iterable<BlobPart>, fileName: string, options?: FilePropertyBag): File;
};

type FormDataEntryValue = File | string;

/** Form fields, sent as multipart/form-data. There are no forms: `new FormData(form)` throws */
interface FormData {
  /** A Blob value is kept as a File, named filename, its own name or "blob" */
  append(name: string, value: string | Blob, filename?: string): void;
  delete(name: string): void;
  get(name: string): FormDataEntryValue | null;
  getAll(name: string): FormDataEntryValue[];
  has(name: string): boolean;
  /** Replaces the first entry with the name and removes the others */
  set(name: string, value: string | Blob, filename?: string): void;
  forEach(callback: (value: FormDataEntryValue, name: string, formData: FormData) => void, thisArg?: unknown): void;
  entries(): IterableIterator<[string, FormDataEntryValue]>;
  keys(): IterableIterator<string>;
  values(): IterableIterator<FormDataEntryValue>;
  [Symbol.iterator](): IterableIterator<[string, FormDataEntryValue]>;
}
declare var FormData: {
  prototype: FormData;
  new (): FormData;
};

/**
 * A parsed URL (WHATWG URL Standard). International domain names are converted to Punycode without the full
 * UTS #46 mapping: unusual characters in host names may come out differently from browsers
 */
interface URL {
  hash: string;
  host: string;
  hostname: string;
  href: string;
  readonly origin: string;
  password: string;
  pathname: string;
  port: string;
  protocol: string;
  search: string;
  /** Live: changing it changes search, and the other way around */
  readonly searchParams: URLSearchParams;
  username: string;
  toString(): string;
  toJSON(): string;
}
declare var URL: {
  prototype: URL;
  /** Throws a TypeError for an invalid URL */
  new (url: string | URL, base?: string | URL): URL;
  canParse(url: string | URL, base?: string | URL): boolean;
  /** null for an invalid URL */
  parse(url: string | URL, base?: string | URL): URL | null;
  /**
   * A `blob:null/<uuid>` URL for the blob: fetch, XMLHttpRequest and the src of CanvasImage, Image and Video load it.
   * It lasts until revoked or until the content stops
   */
  createObjectURL(blob: Blob): string;
  /** fetch can't load it anymore; images and videos that already loaded it keep working */
  revokeObjectURL(url: string): void;
};

/** The query of a URL, application/x-www-form-urlencoded */
interface URLSearchParams {
  readonly size: number;
  append(name: string, value: string): void;
  delete(name: string, value?: string): void;
  get(name: string): string | null;
  getAll(name: string): string[];
  has(name: string, value?: string): boolean;
  set(name: string, value: string): void;
  /** Sorts by name, keeping the order of equal names */
  sort(): void;
  forEach(callback: (value: string, name: string, params: URLSearchParams) => void, thisArg?: unknown): void;
  entries(): IterableIterator<[string, string]>;
  keys(): IterableIterator<string>;
  values(): IterableIterator<string>;
  [Symbol.iterator](): IterableIterator<[string, string]>;
  toString(): string;
}
declare var URLSearchParams: {
  prototype: URLSearchParams;
  new (init?: string | Record<string, string> | Iterable<[string, string]> | URLSearchParams): URLSearchParams;
};

/** Encodes strings as UTF-8 */
interface TextEncoder {
  /** Always "utf-8" */
  readonly encoding: 'utf-8';
  /** Lone surrogates become U+FFFD */
  encode(input?: string): Uint8Array;
  /** Encodes as many whole characters as fit */
  encodeInto(source: string, destination: Uint8Array): { read: number; written: number };
}
declare var TextEncoder: {
  prototype: TextEncoder;
  new (): TextEncoder;
};

interface TextDecoderOptions {
  /** Bad bytes throw a TypeError instead of becoming U+FFFD */
  fatal?: boolean;
  /** Keeps a byte order mark at the start */
  ignoreBOM?: boolean;
}

/**
 * Decodes bytes: UTF-8, UTF-16LE / BE and the legacy encodings of the Encoding Standard (windows-1252, GBK, gb18030,
 * Big5, Shift_JIS, EUC-JP, EUC-KR, ISO-8859-x, KOI8, ...). The legacy multi-byte ones are decoded by the system: a
 * few characters and how bad bytes are replaced may differ a little from browsers
 */
interface TextDecoder {
  /** Lowercased name of the encoding, e.g. "utf-8", "gbk" */
  readonly encoding: string;
  readonly fatal: boolean;
  readonly ignoreBOM: boolean;
  /** stream: true keeps an incomplete character at the end for the next call */
  decode(input?: ArrayBuffer | ArrayBufferView, options?: { stream?: boolean }): string;
}
declare var TextDecoder: {
  prototype: TextDecoder;
  /** Throws a RangeError for an unknown encoding */
  new (label?: string, options?: TextDecoderOptions): TextDecoder;
};

/** Strings in, UTF-8 bytes out */
interface TextEncoderStream extends ReadableWritablePair<Uint8Array, string> {
  readonly encoding: 'utf-8';
}
declare var TextEncoderStream: {
  prototype: TextEncoderStream;
  new (): TextEncoderStream;
};

/** Bytes in, strings out */
interface TextDecoderStream extends ReadableWritablePair<string, ArrayBuffer | ArrayBufferView> {
  readonly encoding: string;
  readonly fatal: boolean;
  readonly ignoreBOM: boolean;
}
declare var TextDecoderStream: {
  prototype: TextDecoderStream;
  new (label?: string, options?: TextDecoderOptions): TextDecoderStream;
};

// -----------------------------------------------------------------------------
// Streams (WHATWG Streams Standard, web-streams-polyfill)
// -----------------------------------------------------------------------------

interface QueuingStrategy<T = any> {
  highWaterMark?: number;
  size?: (chunk: T) => number;
}

interface ByteLengthQueuingStrategy extends QueuingStrategy<ArrayBufferView> {
  readonly highWaterMark: number;
  readonly size: (chunk: ArrayBufferView) => number;
}
declare var ByteLengthQueuingStrategy: {
  prototype: ByteLengthQueuingStrategy;
  new (init: { highWaterMark: number }): ByteLengthQueuingStrategy;
};

interface CountQueuingStrategy extends QueuingStrategy {
  readonly highWaterMark: number;
  readonly size: (chunk?: any) => 1;
}
declare var CountQueuingStrategy: {
  prototype: CountQueuingStrategy;
  new (init: { highWaterMark: number }): CountQueuingStrategy;
};

interface ReadableStreamDefaultController<R = any> {
  readonly desiredSize: number | null;
  close(): void;
  enqueue(chunk?: R): void;
  error(reason?: any): void;
}
declare var ReadableStreamDefaultController: {
  prototype: ReadableStreamDefaultController;
};

interface ReadableStreamBYOBRequest {
  readonly view: ArrayBufferView | null;
  respond(bytesWritten: number): void;
  respondWithNewView(view: ArrayBufferView): void;
}
declare var ReadableStreamBYOBRequest: {
  prototype: ReadableStreamBYOBRequest;
};

interface ReadableByteStreamController {
  readonly byobRequest: ReadableStreamBYOBRequest | null;
  readonly desiredSize: number | null;
  close(): void;
  enqueue(chunk: ArrayBufferView): void;
  error(reason?: any): void;
}
declare var ReadableByteStreamController: {
  prototype: ReadableByteStreamController;
};

interface UnderlyingSource<R = any> {
  start?: (controller: ReadableStreamDefaultController<R>) => any;
  pull?: (controller: ReadableStreamDefaultController<R>) => void | PromiseLike<void>;
  cancel?: (reason?: any) => void | PromiseLike<void>;
  type?: undefined;
}

interface UnderlyingByteSource {
  type: 'bytes';
  start?: (controller: ReadableByteStreamController) => any;
  pull?: (controller: ReadableByteStreamController) => void | PromiseLike<void>;
  cancel?: (reason?: any) => void | PromiseLike<void>;
  autoAllocateChunkSize?: number;
}

type ReadableStreamReadResult<T> = { done: false; value: T } | { done: true; value?: T };

interface ReadableStreamDefaultReader<R = any> {
  readonly closed: Promise<undefined>;
  read(): Promise<ReadableStreamReadResult<R>>;
  cancel(reason?: any): Promise<void>;
  releaseLock(): void;
}
declare var ReadableStreamDefaultReader: {
  prototype: ReadableStreamDefaultReader;
  new <R = any>(stream: ReadableStream<R>): ReadableStreamDefaultReader<R>;
};

/** Reads a byte stream into buffers you provide */
interface ReadableStreamBYOBReader {
  readonly closed: Promise<undefined>;
  read<T extends ArrayBufferView>(view: T, options?: { min?: number }): Promise<ReadableStreamReadResult<T>>;
  cancel(reason?: any): Promise<void>;
  releaseLock(): void;
}
declare var ReadableStreamBYOBReader: {
  prototype: ReadableStreamBYOBReader;
  new (stream: ReadableStream<Uint8Array>): ReadableStreamBYOBReader;
};

interface StreamPipeOptions {
  preventAbort?: boolean;
  preventCancel?: boolean;
  preventClose?: boolean;
  signal?: AbortSignal;
}

interface ReadableWritablePair<R = any, W = any> {
  readonly readable: ReadableStream<R>;
  readonly writable: WritableStream<W>;
}

/** A source of chunks; async iterable (`for await (const chunk of stream)`) */
interface ReadableStream<R = any> {
  readonly locked: boolean;
  cancel(reason?: any): Promise<void>;
  getReader(options: { mode: 'byob' }): ReadableStreamBYOBReader;
  getReader(options?: { mode?: undefined }): ReadableStreamDefaultReader<R>;
  pipeThrough<T>(transform: ReadableWritablePair<T, R>, options?: StreamPipeOptions): ReadableStream<T>;
  pipeTo(destination: WritableStream<R>, options?: StreamPipeOptions): Promise<void>;
  tee(): [ReadableStream<R>, ReadableStream<R>];
  values(options?: { preventCancel?: boolean }): AsyncIterableIterator<R>;
  [Symbol.asyncIterator](options?: { preventCancel?: boolean }): AsyncIterableIterator<R>;
}
declare var ReadableStream: {
  prototype: ReadableStream;
  new (underlyingSource: UnderlyingByteSource, strategy?: { highWaterMark?: number }): ReadableStream<Uint8Array>;
  new <R = any>(underlyingSource?: UnderlyingSource<R>, strategy?: QueuingStrategy<R>): ReadableStream<R>;
  /** A stream of the values of an iterable or async iterable */
  from<R>(asyncIterable: Iterable<R | PromiseLike<R>> | AsyncIterable<R>): ReadableStream<R>;
};

interface WritableStreamDefaultController {
  readonly signal: AbortSignal;
  error(reason?: any): void;
}
declare var WritableStreamDefaultController: {
  prototype: WritableStreamDefaultController;
};

interface UnderlyingSink<W = any> {
  start?: (controller: WritableStreamDefaultController) => any;
  write?: (chunk: W, controller: WritableStreamDefaultController) => void | PromiseLike<void>;
  close?: () => void | PromiseLike<void>;
  abort?: (reason?: any) => void | PromiseLike<void>;
  type?: undefined;
}

interface WritableStreamDefaultWriter<W = any> {
  readonly closed: Promise<undefined>;
  readonly desiredSize: number | null;
  readonly ready: Promise<undefined>;
  abort(reason?: any): Promise<void>;
  close(): Promise<void>;
  releaseLock(): void;
  write(chunk?: W): Promise<void>;
}
declare var WritableStreamDefaultWriter: {
  prototype: WritableStreamDefaultWriter;
  new <W = any>(stream: WritableStream<W>): WritableStreamDefaultWriter<W>;
};

/** A destination of chunks */
interface WritableStream<W = any> {
  readonly locked: boolean;
  abort(reason?: any): Promise<void>;
  close(): Promise<void>;
  getWriter(): WritableStreamDefaultWriter<W>;
}
declare var WritableStream: {
  prototype: WritableStream;
  new <W = any>(underlyingSink?: UnderlyingSink<W>, strategy?: QueuingStrategy<W>): WritableStream<W>;
};

interface TransformStreamDefaultController<O = any> {
  readonly desiredSize: number | null;
  enqueue(chunk?: O): void;
  error(reason?: any): void;
  terminate(): void;
}
declare var TransformStreamDefaultController: {
  prototype: TransformStreamDefaultController;
};

interface Transformer<I = any, O = any> {
  start?: (controller: TransformStreamDefaultController<O>) => any;
  transform?: (chunk: I, controller: TransformStreamDefaultController<O>) => void | PromiseLike<void>;
  flush?: (controller: TransformStreamDefaultController<O>) => void | PromiseLike<void>;
  cancel?: (reason?: any) => void | PromiseLike<void>;
  readableType?: undefined;
  writableType?: undefined;
}

/** Chunks written to writable come out of readable, changed by the transformer */
interface TransformStream<I = any, O = any> extends ReadableWritablePair<O, I> {}
declare var TransformStream: {
  prototype: TransformStream;
  new <I = any, O = any>(transformer?: Transformer<I, O>, writableStrategy?: QueuingStrategy<I>, readableStrategy?: QueuingStrategy<O>): TransformStream<I, O>;
};

/** The global object, like in browsers and workers (`self.URL`) */
declare var self: typeof globalThis;

// -----------------------------------------------------------------------------
// Web Storage: localStorage and sessionStorage
// -----------------------------------------------------------------------------

/**
 * Keys and values (strings), like in browsers; the items are also properties (`storage.name = 'x'`, `Object.keys(storage)`).
 * Up to 5 MB each (keys and values together, counted in UTF-16 code units): over that, setItem throws a
 * `QuotaExceededError` DOMException.
 */
interface Storage {
  /** The number of items */
  readonly length: number;
  /** Removes every item */
  clear(): void;
  /** The value, null when there's no such key */
  getItem(key: string): string | null;
  /** The key at the index, in the order they were added; null past the end */
  key(index: number): string | null;
  removeItem(key: string): void;
  /** Stores the value as a string */
  setItem(key: string, value: string): void;
  [name: string]: any;
}

declare var Storage: DesktopEngine.IllegalConstructor<Storage>;

/**
 * Kept between launches. It belongs to the content: all its instances (e.g. the same widget twice on the desktop) share
 * it and see each other's changes right away, there's no `storage` event. Namespace keys with
 * `DesktopEngine.launchOptions.instanceId` for what belongs to one instance.
 */
declare var localStorage: Storage;
/** Kept in memory while the content runs */
declare var sessionStorage: Storage;

// -----------------------------------------------------------------------------
// Audio: Web Audio and `Audio` elements
//
// Sound needs the "audio" permission in manifest.json: without it an AudioContext stays "suspended" (resume() rejects
// with a "NotAllowedError" DOMException) and play() rejects the same way; OfflineAudioContext and decodeAudioData work.
// An AudioContext starts "running" right away (there's no user gesture to wait for) and is "interrupted" while the app
// pauses the content (on battery power, behind a full-screen app...); playing audio elements pause and continue too.
// decodeAudioData and `Audio` play the formats macOS decodes: MP3, AAC / M4A, WAV, AIFF, CAF, FLAC, ALAC; not Ogg or WebM.
// No AudioWorklet, ScriptProcessorNode, MediaElementAudioSourceNode or media streams.
// -----------------------------------------------------------------------------

type AudioContextState = 'suspended' | 'running' | 'closed' | 'interrupted';
type AutomationRate = 'a-rate' | 'k-rate';
type ChannelCountMode = 'max' | 'clamped-max' | 'explicit';
type ChannelInterpretation = 'speakers' | 'discrete';
type OscillatorType = 'sine' | 'square' | 'sawtooth' | 'triangle' | 'custom';
type BiquadFilterType = 'lowpass' | 'highpass' | 'bandpass' | 'lowshelf' | 'highshelf' | 'peaking' | 'notch' | 'allpass';
/** "HRTF" pans like "equalpower" */
type PanningModelType = 'equalpower' | 'HRTF';
type DistanceModelType = 'linear' | 'inverse' | 'exponential';
/** Accepted, not applied: the curve is never oversampled */
type OverSampleType = 'none' | '2x' | '4x';

interface AudioContextOptions {
  /** The output device's rate by default */
  sampleRate?: number;
  /** Accepted for compatibility, ignored */
  latencyHint?: 'balanced' | 'interactive' | 'playback' | number;
}

interface OfflineAudioContextOptions {
  /** 1 by default */
  numberOfChannels?: number;
  /** In sample-frames */
  length: number;
  sampleRate: number;
}

interface AudioBufferOptions {
  /** 1 by default */
  numberOfChannels?: number;
  length: number;
  sampleRate: number;
}

interface AudioNodeOptions {
  channelCount?: number;
  channelCountMode?: ChannelCountMode;
  channelInterpretation?: ChannelInterpretation;
}

interface AudioBufferSourceOptions extends AudioNodeOptions {
  buffer?: AudioBuffer | null;
  detune?: number;
  loop?: boolean;
  loopEnd?: number;
  loopStart?: number;
  playbackRate?: number;
}

interface OscillatorOptions extends AudioNodeOptions {
  /** "custom" needs periodicWave */
  type?: OscillatorType;
  frequency?: number;
  detune?: number;
  periodicWave?: PeriodicWave;
}

interface PeriodicWaveConstraints {
  disableNormalization?: boolean;
}

interface PeriodicWaveOptions extends PeriodicWaveConstraints {
  /** Cosine terms; at least 2, as many as imag */
  real?: Iterable<number>;
  /** Sine terms; at least 2, as many as real */
  imag?: Iterable<number>;
}

interface ConstantSourceOptions extends AudioNodeOptions {
  offset?: number;
}

interface GainOptions extends AudioNodeOptions {
  gain?: number;
}

interface BiquadFilterOptions extends AudioNodeOptions {
  type?: BiquadFilterType;
  Q?: number;
  detune?: number;
  frequency?: number;
  gain?: number;
}

interface IIRFilterOptions extends AudioNodeOptions {
  /** 1 to 20 coefficients, not all 0 */
  feedforward: Iterable<number>;
  /** 1 to 20 coefficients, the first not 0 */
  feedback: Iterable<number>;
}

interface DelayOptions extends AudioNodeOptions {
  /** Seconds, more than 0 and less than 180; 1 by default */
  maxDelayTime?: number;
  delayTime?: number;
}

interface StereoPannerOptions extends AudioNodeOptions {
  pan?: number;
}

interface PannerOptions extends AudioNodeOptions {
  panningModel?: PanningModelType;
  distanceModel?: DistanceModelType;
  positionX?: number;
  positionY?: number;
  positionZ?: number;
  orientationX?: number;
  orientationY?: number;
  orientationZ?: number;
  refDistance?: number;
  maxDistance?: number;
  rolloffFactor?: number;
  coneInnerAngle?: number;
  coneOuterAngle?: number;
  coneOuterGain?: number;
}

interface AnalyserOptions extends AudioNodeOptions {
  fftSize?: number;
  maxDecibels?: number;
  minDecibels?: number;
  smoothingTimeConstant?: number;
}

interface DynamicsCompressorOptions extends AudioNodeOptions {
  attack?: number;
  knee?: number;
  ratio?: number;
  release?: number;
  threshold?: number;
}

interface ConvolverOptions extends AudioNodeOptions {
  buffer?: AudioBuffer | null;
  disableNormalization?: boolean;
}

interface WaveShaperOptions extends AudioNodeOptions {
  curve?: Iterable<number>;
  oversample?: OverSampleType;
}

interface ChannelSplitterOptions extends AudioNodeOptions {
  /** 1 to 32, 6 by default */
  numberOfOutputs?: number;
}

interface ChannelMergerOptions extends AudioNodeOptions {
  /** 1 to 32, 6 by default */
  numberOfInputs?: number;
}

interface OfflineAudioCompletionEventInit extends EventInit {
  renderedBuffer: AudioBuffer;
}

interface AudioTimestamp {
  contextTime: number;
  /** On the performance.now() clock */
  performanceTime: number;
}

/** Audio samples in memory, one Float32Array per channel */
interface AudioBuffer {
  readonly sampleRate: number;
  /** In sample-frames */
  readonly length: number;
  /** In seconds */
  readonly duration: number;
  readonly numberOfChannels: number;
  /** The channel's samples themselves, not a copy; throws an "IndexSizeError" DOMException for a missing channel */
  getChannelData(channel: number): Float32Array;
  copyFromChannel(destination: Float32Array, channelNumber: number, bufferOffset?: number): void;
  copyToChannel(source: Float32Array, channelNumber: number, bufferOffset?: number): void;
}
declare var AudioBuffer: {
  prototype: AudioBuffer;
  new (options: AudioBufferOptions): AudioBuffer;
};

/** A value of a node, set directly or automated on the context's timeline (times in seconds of context.currentTime) */
interface AudioParam {
  value: number;
  /** Can't be changed on AudioBufferSourceNode's and DynamicsCompressorNode's params (always "k-rate") */
  automationRate: AutomationRate;
  readonly defaultValue: number;
  readonly minValue: number;
  readonly maxValue: number;
  setValueAtTime(value: number, startTime: number): AudioParam;
  linearRampToValueAtTime(value: number, endTime: number): AudioParam;
  /** value can't be 0 */
  exponentialRampToValueAtTime(value: number, endTime: number): AudioParam;
  setTargetAtTime(target: number, startTime: number, timeConstant: number): AudioParam;
  /** At least 2 values, duration more than 0 */
  setValueCurveAtTime(values: Iterable<number>, startTime: number, duration: number): AudioParam;
  cancelScheduledValues(cancelTime: number): AudioParam;
  cancelAndHoldAtTime(cancelTime: number): AudioParam;
}
declare var AudioParam: DesktopEngine.IllegalConstructor<AudioParam>;

/** A node of an audio context's graph */
interface AudioNode extends EventTarget {
  readonly context: BaseAudioContext;
  readonly numberOfInputs: number;
  readonly numberOfOutputs: number;
  /** 1 to 32 */
  channelCount: number;
  channelCountMode: ChannelCountMode;
  channelInterpretation: ChannelInterpretation;
  /** Connects an output to an input of a node of the same context; returns that node, for chaining */
  connect<T extends AudioNode>(destinationNode: T, output?: number, input?: number): T;
  /** Adds an output to the param's value */
  connect(destinationParam: AudioParam, output?: number): void;
  /** Disconnects every output, or the outputs / connections given */
  disconnect(): void;
  disconnect(output: number): void;
  disconnect(destinationNode: AudioNode, output?: number, input?: number): void;
  disconnect(destinationParam: AudioParam, output?: number): void;
}
declare var AudioNode: DesktopEngine.IllegalConstructor<AudioNode>;

/** The context's output: the speakers, or the rendered buffer of an OfflineAudioContext (whose channels can't change) */
interface AudioDestinationNode extends AudioNode {
  readonly maxChannelCount: number;
}
declare var AudioDestinationNode: DesktopEngine.IllegalConstructor<AudioDestinationNode>;

/** Where PannerNodes are heard from */
interface AudioListener {
  readonly positionX: AudioParam;
  readonly positionY: AudioParam;
  readonly positionZ: AudioParam;
  readonly forwardX: AudioParam;
  readonly forwardY: AudioParam;
  readonly forwardZ: AudioParam;
  readonly upX: AudioParam;
  readonly upY: AudioParam;
  readonly upZ: AudioParam;
  setPosition(x: number, y: number, z: number): void;
  setOrientation(x: number, y: number, z: number, xUp: number, yUp: number, zUp: number): void;
}
declare var AudioListener: DesktopEngine.IllegalConstructor<AudioListener>;

/** A source played once between start() and stop() */
interface AudioScheduledSourceNode extends AudioNode {
  /** Called when the source stops playing */
  onended: ((this: AudioScheduledSourceNode, event: Event) => void) | null;
  /** Once only; when is in seconds of context.currentTime, 0 (the default) is now */
  start(when?: number): void;
  /** After start() */
  stop(when?: number): void;
  addEventListener<K extends keyof DesktopEngine.AudioScheduledSourceNodeEventMap>(type: K, listener: (this: this, event: DesktopEngine.AudioScheduledSourceNodeEventMap[K]) => void, options?: DesktopEngine.AddEventListenerOptions | boolean): void;
  addEventListener(type: string, listener: DesktopEngine.EventListenerOrEventListenerObject | null, options?: DesktopEngine.AddEventListenerOptions | boolean): void;
  removeEventListener<K extends keyof DesktopEngine.AudioScheduledSourceNodeEventMap>(type: K, listener: (this: this, event: DesktopEngine.AudioScheduledSourceNodeEventMap[K]) => void): void;
  removeEventListener(type: string, listener: DesktopEngine.EventListenerOrEventListenerObject | null): void;
}
declare var AudioScheduledSourceNode: DesktopEngine.IllegalConstructor<AudioScheduledSourceNode>;

/** Plays an AudioBuffer */
interface AudioBufferSourceNode extends AudioScheduledSourceNode {
  /** Can be set to a buffer once */
  buffer: AudioBuffer | null;
  loop: boolean;
  loopStart: number;
  loopEnd: number;
  readonly playbackRate: AudioParam;
  readonly detune: AudioParam;
  /** Plays from offset (seconds in the buffer) for duration seconds, or to the end */
  start(when?: number, offset?: number, duration?: number): void;
}
declare var AudioBufferSourceNode: {
  prototype: AudioBufferSourceNode;
  new (context: BaseAudioContext, options?: AudioBufferSourceOptions): AudioBufferSourceNode;
};

interface OscillatorNode extends AudioScheduledSourceNode {
  /** "custom" once setPeriodicWave() was called; setting it to "custom" throws an "InvalidStateError" DOMException */
  type: OscillatorType;
  readonly frequency: AudioParam;
  readonly detune: AudioParam;
  setPeriodicWave(periodicWave: PeriodicWave): void;
}
declare var OscillatorNode: {
  prototype: OscillatorNode;
  new (context: BaseAudioContext, options?: OscillatorOptions): OscillatorNode;
};

/** A custom oscillator waveform */
interface PeriodicWave {}
declare var PeriodicWave: {
  prototype: PeriodicWave;
  new (context: BaseAudioContext, options?: PeriodicWaveOptions): PeriodicWave;
};

interface ConstantSourceNode extends AudioScheduledSourceNode {
  readonly offset: AudioParam;
}
declare var ConstantSourceNode: {
  prototype: ConstantSourceNode;
  new (context: BaseAudioContext, options?: ConstantSourceOptions): ConstantSourceNode;
};

interface GainNode extends AudioNode {
  readonly gain: AudioParam;
}
declare var GainNode: {
  prototype: GainNode;
  new (context: BaseAudioContext, options?: GainOptions): GainNode;
};

interface BiquadFilterNode extends AudioNode {
  type: BiquadFilterType;
  readonly frequency: AudioParam;
  readonly detune: AudioParam;
  readonly Q: AudioParam;
  readonly gain: AudioParam;
  /** The three arrays have the same length */
  getFrequencyResponse(frequencyHz: Float32Array, magResponse: Float32Array, phaseResponse: Float32Array): void;
}
declare var BiquadFilterNode: {
  prototype: BiquadFilterNode;
  new (context: BaseAudioContext, options?: BiquadFilterOptions): BiquadFilterNode;
};

interface IIRFilterNode extends AudioNode {
  /** The three arrays have the same length */
  getFrequencyResponse(frequencyHz: Float32Array, magResponse: Float32Array, phaseResponse: Float32Array): void;
}
declare var IIRFilterNode: {
  prototype: IIRFilterNode;
  new (context: BaseAudioContext, options: IIRFilterOptions): IIRFilterNode;
};

interface DelayNode extends AudioNode {
  /** Seconds, up to maxDelayTime */
  readonly delayTime: AudioParam;
}
declare var DelayNode: {
  prototype: DelayNode;
  new (context: BaseAudioContext, options?: DelayOptions): DelayNode;
};

/** Mixes to stereo: channelCount is at most 2, channelCountMode isn't "max" */
interface StereoPannerNode extends AudioNode {
  /** -1 (left) to 1 (right) */
  readonly pan: AudioParam;
}
declare var StereoPannerNode: {
  prototype: StereoPannerNode;
  new (context: BaseAudioContext, options?: StereoPannerOptions): StereoPannerNode;
};

/** Positions a source in 3D relative to context.listener; mixes to stereo like StereoPannerNode */
interface PannerNode extends AudioNode {
  /** "HRTF" pans like "equalpower" */
  panningModel: PanningModelType;
  distanceModel: DistanceModelType;
  readonly positionX: AudioParam;
  readonly positionY: AudioParam;
  readonly positionZ: AudioParam;
  readonly orientationX: AudioParam;
  readonly orientationY: AudioParam;
  readonly orientationZ: AudioParam;
  refDistance: number;
  maxDistance: number;
  rolloffFactor: number;
  coneInnerAngle: number;
  coneOuterAngle: number;
  /** 0 to 1 */
  coneOuterGain: number;
  setPosition(x: number, y: number, z: number): void;
  setOrientation(x: number, y: number, z: number): void;
}
declare var PannerNode: {
  prototype: PannerNode;
  new (context: BaseAudioContext, options?: PannerOptions): PannerNode;
};

/** Frequency and waveform data of what passes through, e.g. for visualizers */
interface AnalyserNode extends AudioNode {
  /** A power of 2 from 32 to 32768, 2048 by default */
  fftSize: number;
  /** fftSize / 2 */
  readonly frequencyBinCount: number;
  minDecibels: number;
  maxDecibels: number;
  /** 0 to 1 */
  smoothingTimeConstant: number;
  /** Fills the array with decibels, up to frequencyBinCount values */
  getFloatFrequencyData(array: Float32Array): void;
  /** Fills the array with 0-255, minDecibels to maxDecibels, up to frequencyBinCount values */
  getByteFrequencyData(array: Uint8Array): void;
  /** Fills the array with samples, up to fftSize values */
  getFloatTimeDomainData(array: Float32Array): void;
  /** Fills the array with samples as 0-255 (128 is 0), up to fftSize values */
  getByteTimeDomainData(array: Uint8Array): void;
}
declare var AnalyserNode: {
  prototype: AnalyserNode;
  new (context: BaseAudioContext, options?: AnalyserOptions): AnalyserNode;
};

/** Mixes to stereo like StereoPannerNode; its params are "k-rate" */
interface DynamicsCompressorNode extends AudioNode {
  readonly threshold: AudioParam;
  readonly knee: AudioParam;
  readonly ratio: AudioParam;
  readonly attack: AudioParam;
  readonly release: AudioParam;
  /** Current gain reduction in decibels */
  readonly reduction: number;
}
declare var DynamicsCompressorNode: {
  prototype: DynamicsCompressorNode;
  new (context: BaseAudioContext, options?: DynamicsCompressorOptions): DynamicsCompressorNode;
};

/** Convolution reverb; mixes to stereo like StereoPannerNode */
interface ConvolverNode extends AudioNode {
  /** An impulse response with 1, 2 or 4 channels, at the context's sample rate */
  buffer: AudioBuffer | null;
  /** Applies when buffer is set */
  normalize: boolean;
}
declare var ConvolverNode: {
  prototype: ConvolverNode;
  new (context: BaseAudioContext, options?: ConvolverOptions): ConvolverNode;
};

interface WaveShaperNode extends AudioNode {
  /** Copied into a new Float32Array when set; at least 2 values */
  get curve(): Float32Array | null;
  set curve(value: Iterable<number> | null);
  /** Accepted, not applied: the curve is never oversampled */
  oversample: OverSampleType;
}
declare var WaveShaperNode: {
  prototype: WaveShaperNode;
  new (context: BaseAudioContext, options?: WaveShaperOptions): WaveShaperNode;
};

/** One output per input channel */
interface ChannelSplitterNode extends AudioNode {}
declare var ChannelSplitterNode: {
  prototype: ChannelSplitterNode;
  new (context: BaseAudioContext, options?: ChannelSplitterOptions): ChannelSplitterNode;
};

/** One mono input per output channel */
interface ChannelMergerNode extends AudioNode {}
declare var ChannelMergerNode: {
  prototype: ChannelMergerNode;
  new (context: BaseAudioContext, options?: ChannelMergerOptions): ChannelMergerNode;
};

/** What AudioContext and OfflineAudioContext share: the graph's nodes, buffers and decoding */
interface BaseAudioContext extends EventTarget {
  readonly sampleRate: number;
  /** Seconds since the context started, the time of start(), stop() and automation */
  readonly currentTime: number;
  readonly destination: AudioDestinationNode;
  readonly listener: AudioListener;
  /** "interrupted" while the app pauses the content */
  readonly state: AudioContextState;
  /** AudioWorklet isn't supported */
  readonly audioWorklet: undefined;
  onstatechange: ((this: BaseAudioContext, event: Event) => void) | null;
  createGain(): GainNode;
  createBufferSource(): AudioBufferSourceNode;
  createOscillator(): OscillatorNode;
  createConstantSource(): ConstantSourceNode;
  createBiquadFilter(): BiquadFilterNode;
  createIIRFilter(feedforward: Iterable<number>, feedback: Iterable<number>): IIRFilterNode;
  createDelay(maxDelayTime?: number): DelayNode;
  createStereoPanner(): StereoPannerNode;
  createPanner(): PannerNode;
  createAnalyser(): AnalyserNode;
  createDynamicsCompressor(): DynamicsCompressorNode;
  createConvolver(): ConvolverNode;
  createWaveShaper(): WaveShaperNode;
  createChannelSplitter(numberOfOutputs?: number): ChannelSplitterNode;
  createChannelMerger(numberOfInputs?: number): ChannelMergerNode;
  createBuffer(numberOfChannels: number, length: number, sampleRate: number): AudioBuffer;
  createPeriodicWave(real: Iterable<number>, imag: Iterable<number>, constraints?: PeriodicWaveConstraints): PeriodicWave;
  /** Not supported: throws a "NotSupportedError" DOMException */
  createScriptProcessor(bufferSize?: number, numberOfInputChannels?: number, numberOfOutputChannels?: number): never;
  /**
   * Decodes a whole audio file (a format macOS decodes) into a buffer at the context's sample rate. The data is copied,
   * not detached. Rejects with an "EncodingError" DOMException when it can't be decoded; the callbacks are optional
   */
  decodeAudioData(audioData: ArrayBuffer | ArrayBufferView, successCallback?: ((decodedData: AudioBuffer) => void) | null, errorCallback?: ((error: DOMException | TypeError) => void) | null): Promise<AudioBuffer>;
  addEventListener<K extends keyof DesktopEngine.BaseAudioContextEventMap>(type: K, listener: (this: this, event: DesktopEngine.BaseAudioContextEventMap[K]) => void, options?: DesktopEngine.AddEventListenerOptions | boolean): void;
  addEventListener(type: string, listener: DesktopEngine.EventListenerOrEventListenerObject | null, options?: DesktopEngine.AddEventListenerOptions | boolean): void;
  removeEventListener<K extends keyof DesktopEngine.BaseAudioContextEventMap>(type: K, listener: (this: this, event: DesktopEngine.BaseAudioContextEventMap[K]) => void): void;
  removeEventListener(type: string, listener: DesktopEngine.EventListenerOrEventListenerObject | null): void;
}
declare var BaseAudioContext: DesktopEngine.IllegalConstructor<BaseAudioContext>;

/**
 * Plays to the speakers. Needs the "audio" permission in manifest.json, otherwise it stays "suspended".
 * Kept alive until close(), like in browsers
 */
interface AudioContext extends BaseAudioContext {
  /** Seconds */
  readonly baseLatency: number;
  /** Seconds */
  readonly outputLatency: number;
  /** Always "": the default output device */
  readonly sinkId: string;
  getOutputTimestamp(): AudioTimestamp;
  /** Rejects with a "NotAllowedError" DOMException without the "audio" permission, "InvalidStateError" once closed */
  resume(): Promise<void>;
  suspend(): Promise<void>;
  /** Stops the sound and frees the context */
  close(): Promise<void>;
  /** Not supported: throws a "NotSupportedError" DOMException */
  createMediaElementSource(mediaElement: HTMLMediaElement): never;
  /** Not supported: throws a "NotSupportedError" DOMException */
  createMediaStreamSource(mediaStream: unknown): never;
  /** Not supported: throws a "NotSupportedError" DOMException */
  createMediaStreamDestination(): never;
}
declare var AudioContext: {
  prototype: AudioContext;
  /** "running" right away when it may: there's no user gesture to wait for */
  new (contextOptions?: AudioContextOptions): AudioContext;
};

/** Renders the graph into an AudioBuffer as fast as it can, without the "audio" permission */
interface OfflineAudioContext extends BaseAudioContext {
  /** In sample-frames */
  readonly length: number;
  oncomplete: ((this: OfflineAudioContext, event: OfflineAudioCompletionEvent) => void) | null;
  /** Once only; resolves with the rendered buffer, then the context is "closed" */
  startRendering(): Promise<AudioBuffer>;
  /** Not supported: rejects with a "NotSupportedError" DOMException */
  resume(): Promise<never>;
  /** Not supported: rejects with a "NotSupportedError" DOMException */
  suspend(suspendTime?: number): Promise<never>;
  addEventListener<K extends keyof DesktopEngine.OfflineAudioContextEventMap>(type: K, listener: (this: this, event: DesktopEngine.OfflineAudioContextEventMap[K]) => void, options?: DesktopEngine.AddEventListenerOptions | boolean): void;
  addEventListener(type: string, listener: DesktopEngine.EventListenerOrEventListenerObject | null, options?: DesktopEngine.AddEventListenerOptions | boolean): void;
  removeEventListener<K extends keyof DesktopEngine.OfflineAudioContextEventMap>(type: K, listener: (this: this, event: DesktopEngine.OfflineAudioContextEventMap[K]) => void): void;
  removeEventListener(type: string, listener: DesktopEngine.EventListenerOrEventListenerObject | null): void;
}
declare var OfflineAudioContext: {
  prototype: OfflineAudioContext;
  new (contextOptions: OfflineAudioContextOptions): OfflineAudioContext;
  new (numberOfChannels: number, length: number, sampleRate: number): OfflineAudioContext;
};

/** The "complete" event of an OfflineAudioContext */
interface OfflineAudioCompletionEvent extends Event {
  readonly renderedBuffer: AudioBuffer;
}
declare var OfflineAudioCompletionEvent: {
  prototype: OfflineAudioCompletionEvent;
  new (type: string, eventInitDict: OfflineAudioCompletionEventInit): OfflineAudioCompletionEvent;
};

/** Why an audio element failed */
interface MediaError {
  readonly code: 1 | 2 | 3 | 4;
  readonly message: string;
  readonly MEDIA_ERR_ABORTED: 1;
  readonly MEDIA_ERR_NETWORK: 2;
  readonly MEDIA_ERR_DECODE: 3;
  readonly MEDIA_ERR_SRC_NOT_SUPPORTED: 4;
}
declare var MediaError: DesktopEngine.IllegalConstructor<MediaError> & {
  readonly MEDIA_ERR_ABORTED: 1;
  readonly MEDIA_ERR_NETWORK: 2;
  readonly MEDIA_ERR_DECODE: 3;
  readonly MEDIA_ERR_SRC_NOT_SUPPORTED: 4;
};

/** Time ranges in seconds (buffered and seekable are the whole file once its duration is known) */
interface TimeRanges {
  readonly length: number;
  /** Throws an "IndexSizeError" DOMException for a missing range */
  start(index: number): number;
  end(index: number): number;
}
declare var TimeRanges: DesktopEngine.IllegalConstructor<TimeRanges>;

/**
 * An audio player with the API of browsers' media elements. It isn't in a document: attributes are plain values,
 * and preload, crossOrigin, defaultMuted, defaultPlaybackRate and preservesPitch are kept but not used.
 * Playing elements aren't collected before they end
 */
interface HTMLMediaElement extends EventTarget {
  /**
   * A package file (resolved like `require`) or, with the "network" permission, an http(s) URL; no data: URLs.
   * Setting it loads
   */
  src: string;
  readonly currentSrc: string;
  /** Plays once it can */
  autoplay: boolean;
  loop: boolean;
  muted: boolean;
  /** 0 to 1 */
  volume: number;
  /** 0 to 16 */
  playbackRate: number;
  /** Setting it seeks */
  currentTime: number;
  /** NaN until the metadata has loaded */
  readonly duration: number;
  readonly paused: boolean;
  readonly ended: boolean;
  readonly seeking: boolean;
  /** HAVE_NOTHING ... HAVE_ENOUGH_DATA */
  readonly readyState: 0 | 1 | 2 | 3 | 4;
  /** NETWORK_EMPTY ... NETWORK_NO_SOURCE */
  readonly networkState: 0 | 1 | 2 | 3;
  readonly error: MediaError | null;
  readonly buffered: TimeRanges;
  readonly seekable: TimeRanges;
  /** Always empty */
  readonly played: TimeRanges;
  preload: string;
  crossOrigin: string | null;
  defaultMuted: boolean;
  defaultPlaybackRate: number;
  preservesPitch: boolean;
  /** Stops and loads src again; a pending play() rejects with an "AbortError" DOMException */
  load(): void;
  /**
   * Loads if needed and resolves once playing. Rejects with a "NotAllowedError" DOMException without the "audio"
   * permission, "NotSupportedError" when the source can't be loaded or decoded, "AbortError" after pause() or load()
   */
  play(): Promise<void>;
  pause(): void;
  /** Seeks, after the metadata has loaded if it hasn't yet */
  fastSeek(time: number): void;
  /** "probably", "maybe" or "" for a MIME type, e.g. "audio/mpeg" */
  canPlayType(type: string): '' | 'maybe' | 'probably';
  /** "src", "autoplay", "loop" and "muted" set the properties */
  setAttribute(name: string, value: string): void;
  getAttribute(name: string): string | null;
  removeAttribute(name: string): void;
  hasAttribute(name: string): boolean;
  onabort: ((this: HTMLMediaElement, event: Event) => void) | null;
  oncanplay: ((this: HTMLMediaElement, event: Event) => void) | null;
  oncanplaythrough: ((this: HTMLMediaElement, event: Event) => void) | null;
  ondurationchange: ((this: HTMLMediaElement, event: Event) => void) | null;
  onemptied: ((this: HTMLMediaElement, event: Event) => void) | null;
  onended: ((this: HTMLMediaElement, event: Event) => void) | null;
  onerror: ((this: HTMLMediaElement, event: Event) => void) | null;
  onloadeddata: ((this: HTMLMediaElement, event: Event) => void) | null;
  onloadedmetadata: ((this: HTMLMediaElement, event: Event) => void) | null;
  onloadstart: ((this: HTMLMediaElement, event: Event) => void) | null;
  onpause: ((this: HTMLMediaElement, event: Event) => void) | null;
  onplay: ((this: HTMLMediaElement, event: Event) => void) | null;
  onplaying: ((this: HTMLMediaElement, event: Event) => void) | null;
  onprogress: ((this: HTMLMediaElement, event: Event) => void) | null;
  onratechange: ((this: HTMLMediaElement, event: Event) => void) | null;
  onseeked: ((this: HTMLMediaElement, event: Event) => void) | null;
  onseeking: ((this: HTMLMediaElement, event: Event) => void) | null;
  onstalled: ((this: HTMLMediaElement, event: Event) => void) | null;
  onsuspend: ((this: HTMLMediaElement, event: Event) => void) | null;
  ontimeupdate: ((this: HTMLMediaElement, event: Event) => void) | null;
  onvolumechange: ((this: HTMLMediaElement, event: Event) => void) | null;
  onwaiting: ((this: HTMLMediaElement, event: Event) => void) | null;
  addEventListener<K extends keyof DesktopEngine.HTMLMediaElementEventMap>(type: K, listener: (this: this, event: DesktopEngine.HTMLMediaElementEventMap[K]) => void, options?: DesktopEngine.AddEventListenerOptions | boolean): void;
  addEventListener(type: string, listener: DesktopEngine.EventListenerOrEventListenerObject | null, options?: DesktopEngine.AddEventListenerOptions | boolean): void;
  removeEventListener<K extends keyof DesktopEngine.HTMLMediaElementEventMap>(type: K, listener: (this: this, event: DesktopEngine.HTMLMediaElementEventMap[K]) => void): void;
  removeEventListener(type: string, listener: DesktopEngine.EventListenerOrEventListenerObject | null): void;
  readonly HAVE_NOTHING: 0;
  readonly HAVE_METADATA: 1;
  readonly HAVE_CURRENT_DATA: 2;
  readonly HAVE_FUTURE_DATA: 3;
  readonly HAVE_ENOUGH_DATA: 4;
  readonly NETWORK_EMPTY: 0;
  readonly NETWORK_IDLE: 1;
  readonly NETWORK_LOADING: 2;
  readonly NETWORK_NO_SOURCE: 3;
}
declare var HTMLMediaElement: DesktopEngine.IllegalConstructor<HTMLMediaElement> & {
  readonly HAVE_NOTHING: 0;
  readonly HAVE_METADATA: 1;
  readonly HAVE_CURRENT_DATA: 2;
  readonly HAVE_FUTURE_DATA: 3;
  readonly HAVE_ENOUGH_DATA: 4;
  readonly NETWORK_EMPTY: 0;
  readonly NETWORK_IDLE: 1;
  readonly NETWORK_LOADING: 2;
  readonly NETWORK_NO_SOURCE: 3;
};

/** An audio element, made with `new Audio(src)` */
interface HTMLAudioElement extends HTMLMediaElement {}
declare var HTMLAudioElement: DesktopEngine.IllegalConstructor<HTMLAudioElement>;

/**
 * Makes an audio element and, with src, starts loading it: a package file or, with the "network" permission, an
 * http(s) URL. Formats are the ones macOS decodes (MP3, AAC / M4A, WAV, AIFF, CAF, FLAC, ALAC); playing needs the
 * "audio" permission
 */
declare var Audio: {
  prototype: HTMLAudioElement;
  new (src?: string): HTMLAudioElement;
};

/**
 * Copies the enumerable members of the objects (methods are bound to their original object) to target
 * @remarks A helper exposed by the engine's core polyfill
 */
declare function mixin(instances: object[], target: object): void;

/**
 * Wraps the methods on an object's prototype to return Promises (injecting success/fail into the first argument object)
 * @remarks A helper exposed by the engine's core polyfill; this inside then is the global object
 */
declare function promisify(obj: object): void;

/**
 * Sends a message to the app. Widgets and desktop pets placed on the desktop use `'host'` to report the window position or to ask to be removed.
 */
declare function postMessage(name: 'host', message: DesktopEngine.HostMessage): void;
/** Sends a message to the app (native side), received by the handler the app registered for name */
declare function postMessage(name: string, message?: unknown): void;

/** CommonJS require (resolved relative to the package root in the entry index.js) */
declare var require: DesktopEngine.RequireFunction;

/**
 * The current module object
 * @remarks Available only inside modules loaded with require; not present in the entry index.js
 */
declare var module: DesktopEngine.Module;

/**
 * The current module's exports object
 * @remarks Available only inside modules loaded with require; not present in the entry index.js
 */
declare var exports: any;
