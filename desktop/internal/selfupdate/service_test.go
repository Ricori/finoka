package selfupdate

import (
	"crypto/sha512"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"testing"

	"github.com/wailsapp/wails/v3/pkg/application"
	wailsupdater "github.com/wailsapp/wails/v3/pkg/updater"
)

func TestNewerVersion(t *testing.T) {
	for _, test := range []struct {
		candidate string
		current   string
		want      bool
	}{
		{"0.2.0", "0.1.9", true},
		{"v1.0.1", "1.0.0", true},
		{"1.0.0", "1.0.0", false},
		{"0.9.9", "1.0.0", false},
	} {
		if got := newerVersion(test.candidate, test.current); got != test.want {
			t.Fatalf("newerVersion(%q, %q) = %v", test.candidate, test.current, got)
		}
	}
}

func TestManifestURLPrefersExplicitOverride(t *testing.T) {
	t.Setenv(baseEnvironment, "https://example.test/updates/")
	if got := manifestURL(); got != "https://example.test/updates/wails/latest.json" {
		t.Fatalf("manifestURL() = %q", got)
	}
	t.Setenv(manifestEnvironment, "https://example.test/pinned.json")
	if got := manifestURL(); got != "https://example.test/pinned.json" {
		t.Fatalf("manifestURL() = %q", got)
	}
}

func TestRemoveReplacedExecutables(t *testing.T) {
	directory := t.TempDir()
	executable := filepath.Join(directory, "Nonoka X.exe")
	replaced := []string{
		executable + ".old.1786267404207847300",
		executable + ".old.1786267404207847301",
	}
	kept := []string{executable, filepath.Join(directory, "keep.old.1")}
	for _, path := range append(append([]string{}, kept...), replaced...) {
		if err := os.WriteFile(path, []byte("fixture"), 0o600); err != nil {
			t.Fatal(err)
		}
	}

	if remaining := removeReplacedExecutables(executable); remaining != 0 {
		t.Fatalf("%d replaced executables remain", remaining)
	}
	for _, path := range replaced {
		if _, err := os.Stat(path); !os.IsNotExist(err) {
			t.Fatalf("replaced executable was not removed: %s", path)
		}
	}
	for _, path := range kept {
		if _, err := os.Stat(path); err != nil {
			t.Fatalf("unrelated file was removed: %s", path)
		}
	}
}

func TestReleaseMandatoryUsesManifestMetadata(t *testing.T) {
	release := &wailsupdater.Release{Metadata: map[string]any{"minVersion": "0.2.0"}}
	if !releaseMandatory(release, "0.1.0") || releaseMandatory(release, "0.2.0") {
		t.Fatal("mandatory version comparison is incorrect")
	}
}

func TestConsumeReleaseNotesOnce(t *testing.T) {
	service, err := New(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	want := ReleaseNotes{Version: Version, Notes: "fixed playback"}
	if err := writeJSONAtomic(service.releaseNotesPath(), want); err != nil {
		t.Fatal(err)
	}
	got, err := service.ConsumeReleaseNotes()
	if err != nil || got == nil || *got != want {
		t.Fatalf("notes = %#v, err = %v", got, err)
	}
	if _, err := os.Stat(service.releaseNotesPath()); !os.IsNotExist(err) {
		t.Fatal("release notes were not consumed")
	}
	if got, err := service.ConsumeReleaseNotes(); err != nil || got != nil {
		t.Fatalf("second read returned %#v, err = %v", got, err)
	}
}

// A pending marker is what authorises installing on the following launch, so it
// has to survive a write and be cleared by the read that consumes it.
func TestConsumePendingUpdateClearsMarker(t *testing.T) {
	service, err := New(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	if service.consumePending() {
		t.Fatal("pending update reported without a marker")
	}
	service.markPending("9.9.9")
	if !service.consumePending() {
		t.Fatal("pending marker was not observed")
	}
	if service.consumePending() {
		t.Fatal("pending marker was not cleared")
	}
}

func TestCheckDownloadsAndVerifiesEndpointArtifact(t *testing.T) {
	artifact := []byte("nonoka update fixture")
	digest := sha512.Sum512(artifact)
	parts := strings.Split(Version, ".")
	patch, _ := strconv.Atoi(parts[2])
	updateVersion := fmt.Sprintf("%s.%s.%d", parts[0], parts[1], patch+1)
	server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		switch request.URL.Path {
		case "/latest.json":
			_ = json.NewEncoder(response).Encode(map[string]any{
				"schemaVersion": 1,
				"version":       updateVersion,
				"channel":       "stable",
				"notes":         "update smoke",
				"artifacts": []map[string]any{{
					"url": "/artifact.exe", "platform": runtime.GOOS, "arch": runtime.GOARCH,
					"filename": "Nonoka-X-windows-amd64.exe", "size": len(artifact),
					"digestAlgo": "sha512", "digest": base64.StdEncoding.EncodeToString(digest[:]),
				}},
			})
		case "/artifact.exe":
			_, _ = response.Write(artifact)
		default:
			http.NotFound(response, request)
		}
	}))
	defer server.Close()

	t.Setenv(manifestEnvironment, server.URL+"/latest.json")
	service, err := New(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	app := application.New(application.Options{Name: "update-test"})
	if err := Attach(service, app); err != nil {
		t.Fatal(err)
	}
	service.check(t.Context(), false)

	status := service.GetStatus()
	if !status.Ready || status.Version != updateVersion || status.Stage != "ready" {
		t.Fatalf("update status = %#v", status)
	}
	downloaded := app.Updater.DownloadedPath()
	if _, err := os.Stat(downloaded); err != nil {
		t.Fatalf("verified update artifact was not staged: %v", err)
	}
	t.Cleanup(func() { _ = os.RemoveAll(filepath.Dir(downloaded)) })
	var notes ReleaseNotes
	if err := readJSON(service.releaseNotesPath(), &notes); err != nil || notes.Version != updateVersion {
		t.Fatalf("release notes = %#v, err = %v", notes, err)
	}
	// The optional path defers installation, leaving a marker for next launch.
	if !service.consumePending() {
		t.Fatal("optional update did not leave a pending marker")
	}
}

// A dev build that has not opted in must leave the running binary alone.
func TestStartSkipsDevelopmentBuildsWithoutManifest(t *testing.T) {
	if productionBuild {
		t.Skip("production builds check on their own")
	}
	service, err := New(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	Start(service, nil)
	if stage := service.GetStatus().Stage; stage != "idle" {
		t.Fatalf("development build started an update check: stage = %q", stage)
	}
}
