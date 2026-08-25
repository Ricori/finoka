package app

import (
	"net/url"

	"github.com/Ricori/finoka/desktop/internal/preferences"
	"github.com/wailsapp/wails/v3/pkg/application"
)

// applyWindowTheme keeps the native window background and the webview's first
// render on the saved theme. The frontend reads the query value synchronously,
// before its stylesheet or React tree can paint.
func applyWindowTheme(store *preferences.Service, kind string, options application.WebviewWindowOptions) application.WebviewWindowOptions {
	state := store.Get()
	theme := state.HomeTheme
	if kind == "editor" {
		theme = state.EditorTheme
	}
	if theme == "dark" {
		options.BackgroundColour = application.NewRGB(23, 27, 42)
		options.Windows.Theme = application.Dark
	} else {
		theme = "light"
		options.BackgroundColour = application.NewRGB(247, 245, 239)
		options.Windows.Theme = application.Light
	}

	if target, err := url.Parse(options.URL); err == nil {
		query := target.Query()
		query.Set("theme", theme)
		target.RawQuery = query.Encode()
		options.URL = target.String()
	}
	return options
}
