package main

import (
	"embed"
	"io/fs"
	"log"

	"github.com/Ricori/nonoka-x/desktop/internal/app"
)

// frontend/dist contains the Vite application in release builds. A tracked
// placeholder keeps contract-only Go builds valid before the frontend job runs.
//
//go:embed all:frontend/dist
var assets embed.FS

func main() {
	staticAssets, err := fs.Sub(assets, "frontend/dist")
	if err != nil {
		log.Fatal(err)
	}
	if err := app.Run(staticAssets); err != nil {
		log.Fatal(err)
	}
}
