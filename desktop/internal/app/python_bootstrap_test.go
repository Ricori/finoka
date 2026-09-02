package app

import (
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"

	"github.com/Ricori/nonoka-x/desktop/internal/managedtools"
	"github.com/Ricori/nonoka-x/desktop/internal/sidecar"
)

func TestPythonBootstrapDetectsInstalledLauncher(t *testing.T) {
	data := t.TempDir()
	python := managedtools.BootstrapPython(data)
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

func TestGitHubDownloadURLsOrderAndEnvironment(t *testing.T) {
	raw := "https://github.com/example/repo/releases/download/v1.0/file.zip"

	// Default without environment override: official URL first, followed by default mirrors
	urls := gitHubDownloadURLs(raw)
	if len(urls) < 2 {
		t.Fatalf("expected multiple URLs, got %d", len(urls))
	}
	if urls[0] != raw {
		t.Fatalf("first URL = %s, want %s", urls[0], raw)
	}
	for _, prefix := range defaultGitHubMirrorPrefixes {
		mirrorURL := prefix + raw
		if !containsString(urls, mirrorURL) {
			t.Errorf("expected mirror URL %s in list", mirrorURL)
		}
	}

	// With NONOKA_GITHUB_PROXY environment variable
	t.Setenv("NONOKA_GITHUB_PROXY", "https://custom-proxy.example.com")
	urlsCustom := gitHubDownloadURLs(raw)
	if len(urlsCustom) == 0 || urlsCustom[0] != "https://custom-proxy.example.com/"+raw {
		t.Fatalf("custom proxy not prioritized: %#v", urlsCustom)
	}
}

func TestDownloadWithFallbackFailsWithManualInstructions(t *testing.T) {
	data := t.TempDir()
	bootstrap := NewPythonBootstrap(data, sidecar.New(sidecar.Config{}))
	destination := filepath.Join(data, "uv.zip")

	// Invalid candidate URLs that cannot be connected to
	candidateURLs := []string{
		"http://127.0.0.1:54321/nonexistent1.zip",
		"http://127.0.0.1:54321/nonexistent2.zip",
	}

	err := bootstrap.downloadWithFallback(candidateURLs, destination, 100, "dummy-digest")
	if err == nil {
		t.Fatal("expected error, got nil")
	}

	errMsg := err.Error()
	if !strings.Contains(errMsg, "手动下载") {
		t.Errorf("expected manual download guidance in error message, got: %s", errMsg)
	}
	if !strings.Contains(errMsg, destination) {
		t.Errorf("expected destination path in error message, got: %s", errMsg)
	}
	if !strings.Contains(errMsg, bootstrapUVURL) {
		t.Errorf("expected official download link in error message, got: %s", errMsg)
	}
}
