package app

import (
	"context"
	"errors"
	"io/fs"
	"log"
	"path/filepath"
	"runtime"
	"time"

	"github.com/Ricori/finoka/desktop/internal/cloud"
	"github.com/Ricori/finoka/desktop/internal/library"
	"github.com/Ricori/finoka/desktop/internal/plugins"
	"github.com/Ricori/finoka/desktop/internal/preferences"
	"github.com/Ricori/finoka/desktop/internal/provider"
	"github.com/Ricori/finoka/desktop/internal/selfupdate"
	"github.com/Ricori/finoka/desktop/internal/sidecar"
	"github.com/wailsapp/wails/v3/pkg/application"
	"github.com/wailsapp/wails/v3/pkg/events"
)

const lifecycleTimeout = 20 * time.Second

var bundledFontNames = []string{"FZZhunYuan.woff2", "JingNanBoBoHei.woff2"}

func init() {
	application.RegisterEvent[[]string]("files:dropped")
	application.RegisterEvent[[]library.Entry]("library:changed")
	application.RegisterEvent[string]("editor:request-close")
	application.RegisterEvent[bool]("home:refresh")
	application.RegisterEvent[selfupdate.Status]("update:status")
	application.RegisterEvent[map[string]string]("update:ready")
}

// Run owns the desktop lifecycle. Sidecar startup failure is intentionally
// non-fatal: the shell remains available so the settings/runtime UI can explain
// what is missing. The failure is retained in the manager's safe Snapshot.
func Run(assets fs.FS) error {
	selfupdate.CleanupReplacedExecutables()
	dataDirectory, err := DataDirectory()
	if err != nil {
		return err
	}
	libraryService, err := library.New(dataDirectory)
	if err != nil {
		return err
	}
	fonts := make(map[string][]byte, len(bundledFontNames))
	for _, name := range bundledFontNames {
		data, readErr := fs.ReadFile(assets, "fonts/"+name)
		if readErr != nil {
			log.Printf("bundled font %s: %v", name, readErr)
			continue
		}
		fonts[name] = data
	}
	library.SetBundledFonts(libraryService, fonts)
	preferencesService, err := preferences.New(dataDirectory)
	if err != nil {
		return err
	}
	pluginService, err := plugins.New(dataDirectory, libraryService)
	if err != nil {
		return err
	}
	config, configErr := SidecarConfig()
	manager := sidecar.New(config)
	pythonBootstrap := NewPythonBootstrap(dataDirectory, manager)
	if configErr != nil {
		log.Printf("sidecar configuration: %v", configErr)
	}
	startupContext, cancel := context.WithTimeout(context.Background(), lifecycleTimeout)
	_, startErr := manager.Start(startupContext)
	cancel()
	if startErr != nil {
		log.Printf("sidecar startup: %v", startErr)
	}
	providerService, err := provider.New(manager, pythonBootstrap)
	if err != nil {
		return err
	}
	cloudService, err := cloud.New(dataDirectory, manager, libraryService)
	if err != nil {
		return err
	}
	windowService := NewWindowService(preferencesService, libraryService)
	updateService, err := selfupdate.New(dataDirectory)
	if err != nil {
		return err
	}

	applicationInstance := application.New(application.Options{
		Name:        "Finoka",
		Description: "Local-first subtitle production",
		Services: []application.Service{
			application.NewService(providerService),
			application.NewService(libraryService),
			application.NewService(cloudService),
			application.NewService(pluginService),
			application.NewService(preferencesService),
			application.NewService(windowService),
			application.NewService(updateService),
		},
		Assets: application.AssetOptions{
			Handler: application.AssetFileServerFS(assets),
		},
		Mac: application.MacOptions{
			ApplicationShouldTerminateAfterLastWindowClosed: true,
		},
		Windows: application.WindowsOptions{WebviewUserDataPath: filepath.Join(dataDirectory, "webview")},
	})
	homeOptions := applyWindowOptions(preferencesService, "home", applyWindowTheme(preferencesService, "home", application.WebviewWindowOptions{
		Name:            "home",
		Title:           "Finoka",
		Width:           1180,
		Height:          760,
		MinWidth:        960,
		MinHeight:       620,
		InitialPosition: application.WindowCentered,
		URL:             "/index.html",
		EnableFileDrop:  true,
		Frameless:       runtime.GOOS == "windows",
		Windows: application.WindowsWindow{
			// Composition hosting is what turns --wails-non-client-region into real
			// WM_NCHITTEST results, so the custom titlebar drags, snap-layouts and
			// caption buttons behave like a native frame instead of a JS mousemove.
			NonClientRegionSupport:     true,
			WebView2CompositionHosting: true,
		},
	}))
	homeOptions, deferredState := deferWindowStart(homeOptions)
	home := applicationInstance.Window.NewWithOptions(homeOptions)
	windowService.attach(applicationInstance, home)
	plugins.Attach(pluginService, applicationInstance, home)
	// A missing or unreachable manifest must not block startup: the shell
	// simply stays on the current build.
	if err := selfupdate.Attach(updateService, applicationInstance); err != nil {
		log.Printf("auto update: %v", err)
	} else {
		selfupdate.Start(updateService, windowService.editorIsOpen)
	}
	if deferredState != application.WindowStateNormal {
		home.OnWindowEvent(events.Common.WindowRuntimeReady, func(_ *application.WindowEvent) { showDeferredWindow(home, deferredState) })
	}
	trackWindowState(preferencesService, "home", applicationInstance, home).Activate()
	library.Attach(libraryService, applicationInstance, home)
	home.OnWindowEvent(events.Common.WindowFilesDropped, func(event *application.WindowEvent) {
		applicationInstance.Event.Emit("files:dropped", event.Context().DroppedFiles())
	})
	runErr := applicationInstance.Run()
	shutdownContext, cancel := context.WithTimeout(context.Background(), lifecycleTimeout)
	stopErr := manager.Stop(shutdownContext)
	cancel()
	return errors.Join(runErr, stopErr, libraryService.Close())
}
