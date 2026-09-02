package main

import (
	"embed"
	"io/fs"
	"log"

	"github.com/Ricori/nonoka-x/desktop/internal/app"
	"github.com/Ricori/nonoka-x/desktop/internal/selfupdate"
)

// frontend/dist contains the Vite application in release builds. A tracked
// placeholder keeps contract-only Go builds valid before the frontend job runs.
//
//go:embed all:frontend/dist
var assets embed.FS

func main() {
	// A process re-executed to install a staged update does nothing else, so
	// this runs before any asset, window or data directory is touched.
	selfupdate.HandleInstaller()
	staticAssets, err := fs.Sub(assets, "frontend/dist")
	if err != nil {
		log.Fatal(err)
	}
	if err := app.Run(staticAssets); err != nil {
		log.Fatal(err)
	}
}
