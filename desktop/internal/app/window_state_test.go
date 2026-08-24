package app

import (
	"testing"

	"github.com/Ricori/finoka/desktop/internal/preferences"
	"github.com/wailsapp/wails/v3/pkg/application"
)

func TestEditorWindowDefaultsToCenteredNormalSize(t *testing.T) {
	store, err := preferences.New(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}

	options := editorWindowOptions(store, "media id", "Fixture")
	if options.StartState != application.WindowStateNormal {
		t.Fatalf("start state = %v, want normal", options.StartState)
	}
	if options.InitialPosition != application.WindowCentered {
		t.Fatalf("initial position = %v, want centered", options.InitialPosition)
	}
	if options.Width != 1440 || options.Height != 900 {
		t.Fatalf("size = %dx%d, want 1440x900", options.Width, options.Height)
	}
	if !options.Hidden {
		t.Fatal("editor window must remain hidden until the frontend reports it is ready")
	}
	if options.Mac.TitleBar != application.MacTitleBarHiddenInsetUnified {
		t.Fatal("macOS editor titlebar does not use the inset unified traffic-light layout")
	}
	if options.Mac.InvisibleTitleBarHeight != 48 {
		t.Fatalf("macOS draggable titlebar height = %d, want 48", options.Mac.InvisibleTitleBarHeight)
	}
}

func TestSavedNormalEditorBoundsOverrideWindowDefaults(t *testing.T) {
	store, err := preferences.New(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	want := preferences.WindowBounds{X: 125, Y: 86, Width: 1280, Height: 760}
	if err := store.SetWindowBounds("editor", want); err != nil {
		t.Fatal(err)
	}

	options := applyWindowOptions(store, "editor", application.WebviewWindowOptions{
		MinWidth:   960,
		MinHeight:  620,
		StartState: application.WindowStateMaximised,
	})
	if options.StartState != application.WindowStateNormal {
		t.Fatalf("start state = %v, want saved normal state", options.StartState)
	}
	if options.InitialPosition != application.WindowXY || options.X != want.X || options.Y != want.Y {
		t.Fatalf("position = (%d,%d), want (%d,%d)", options.X, options.Y, want.X, want.Y)
	}
	if options.Width != want.Width || options.Height != want.Height {
		t.Fatalf("size = %dx%d, want %dx%d", options.Width, options.Height, want.Width, want.Height)
	}
}

func TestSavedMaximisedEditorStateIsRestored(t *testing.T) {
	store, err := preferences.New(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	want := preferences.WindowBounds{X: 80, Y: 60, Width: 1360, Height: 820, Maximized: true}
	if err := store.SetWindowBounds("editor", want); err != nil {
		t.Fatal(err)
	}

	options := editorWindowOptions(store, "fixture", "Fixture")
	if options.StartState != application.WindowStateMaximised {
		t.Fatalf("start state = %v, want maximised", options.StartState)
	}
	if options.Width != want.Width || options.Height != want.Height {
		t.Fatalf("normal size = %dx%d, want %dx%d", options.Width, options.Height, want.Width, want.Height)
	}
}
