package app

import (
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"testing"

	"github.com/Ricori/finoka/desktop/internal/sidecar"
)

func TestPythonBootstrapDetectsInstalledLauncher(t *testing.T) {
	data := t.TempDir()
	python := managedBootstrapPython(data)
	if err := os.MkdirAll(filepath.Dir(python), 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(python, []byte("fixture"), 0o700); err != nil {
		t.Fatal(err)
	}
	bootstrap := NewPythonBootstrap(data, sidecar.New(sidecar.Config{}))
	status := bootstrap.Status()
	if status["state"] != "ready" || status["python"] != python {
		t.Fatalf("status = %#v", status)
	}
	wantSupported := runtime.GOOS == "windows" && runtime.GOARCH == "amd64"
	if status["supported"] != wantSupported {
		t.Fatalf("supported = %#v, want %v", status["supported"], wantSupported)
	}
}

func TestFileMatchesRequiresSizeAndSHA256(t *testing.T) {
	path := filepath.Join(t.TempDir(), "asset.zip")
	contents := []byte("pinned bootstrap asset")
	if err := os.WriteFile(path, contents, 0o600); err != nil {
		t.Fatal(err)
	}
	digest := fmt.Sprintf("%x", sha256.Sum256(contents))
	if !fileMatches(path, int64(len(contents)), digest) {
		t.Fatal("matching file was rejected")
	}
	if fileMatches(path, int64(len(contents)+1), digest) || fileMatches(path, int64(len(contents)), "00") {
		t.Fatal("invalid size or digest was accepted")
	}
}

func TestBootstrapUVPinMatchesFineSubManifest(t *testing.T) {
	manifestPath := filepath.Join("..", "..", "..", "third_party", "finesub", "resources", "runtime-manifest.json")
	contents, err := os.ReadFile(manifestPath)
	if err != nil {
		t.Fatal(err)
	}
	var manifest struct {
		Resources []struct {
			ID    string `json:"id"`
			Asset struct {
				URL    string `json:"url"`
				Size   int64  `json:"size"`
				SHA256 string `json:"sha256"`
			} `json:"asset"`
		} `json:"resources"`
	}
	if err := json.Unmarshal(contents, &manifest); err != nil {
		t.Fatal(err)
	}
	for _, resource := range manifest.Resources {
		if resource.ID == "uv" {
			if resource.Asset.URL != bootstrapUVURL || resource.Asset.Size != bootstrapUVSize || resource.Asset.SHA256 != bootstrapUVSHA256 {
				t.Fatalf("bootstrap uv pin drifted from FineSub manifest: %#v", resource.Asset)
			}
			return
		}
	}
	t.Fatal("FineSub runtime manifest has no uv resource")
}
