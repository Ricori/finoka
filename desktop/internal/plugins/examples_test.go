package plugins

import (
	"path/filepath"
	"strings"
	"testing"
)

// The packaged examples are committed artifacts: users install them straight
// from the repository, so a stale or malformed one is a broken first
// experience. Installing each here is what keeps a rebuilt example honest --
// it exercises the same extraction, manifest validation and permission check
// the desktop runs.
func TestShippedExamplePackagesInstall(t *testing.T) {
	packages, err := filepath.Glob(filepath.Join("..", "..", "examples", "plugins", "*.finoka-plugin"))
	if err != nil {
		t.Fatal(err)
	}
	if len(packages) == 0 {
		t.Fatal("no example packages found; the glob or the examples moved")
	}
	for _, packagePath := range packages {
		t.Run(filepath.Base(packagePath), func(t *testing.T) {
			service, err := New(t.TempDir())
			if err != nil {
				t.Fatal(err)
			}
			installed, err := service.Install(packagePath)
			if err != nil {
				t.Fatalf("example failed to install: %v", err)
			}
			if len(installed.Contributes.Tools) == 0 {
				t.Fatal("example contributes no tools")
			}
			// The page has to load through the same policy injection the desktop
			// uses, or the example would install and then fail to open.
			page, err := service.PageHTML(installed.ID, installed.Contributes.Tools[0].ID)
			if err != nil {
				t.Fatalf("example page did not load: %v", err)
			}
			if !strings.Contains(page, "window.finoka") {
				t.Fatal("example page did not receive the host bridge")
			}
		})
	}
}
