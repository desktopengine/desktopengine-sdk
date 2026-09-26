# Design Guidelines

Content follows DesktopEngine's design guidelines, in keeping with the system:

- Use the system font and restrained colors, leaving color to the content itself.
- Widgets keep WidgetKit's sizes (`small` 164×164, `medium` 344×164, `large` 344×344) and corner radius (about 22 points). Don't repeat the widgets the system has (clock, calendar, weather, reminders, photos, stocks, batteries and so on).
- Things on the desktop should be quiet: widgets refresh when they need to, without constant animation; desktop pets redraw only when the picture changes (as the pet template does).
- Follow the system's light and dark: an Appearance option offers `auto` (following the system) as its default, see [Appearance](./launch-options#appearance).
- Leave settings to the app: declare what can be changed as [options](/reference/manifest#options-parameters) and the app draws them as a native form. Don't build a settings UI of your own.
- The app pauses content when it should (see [Pausing](./performance#pausing)), so you don't handle it yourself. The frame rate limit is set for everything in Settings › General › Performance.
