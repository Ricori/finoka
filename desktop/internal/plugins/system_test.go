package plugins

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// systemPlugin returns the single built-in the binary ships, failing the test if
// the embedded tree stopped producing one.
func systemPlugin(t *testing.T, service *Service) InstalledPlugin {
	t.Helper()
	for _, plugin := range service.List() {
		if plugin.System {
			return plugin
		}
	}
	t.Fatal("no system plugin was published")
	return InstalledPlugin{}
}

func TestSystemPluginsPublishEnabledOnFirstLaunch(t *testing.T) {
	root := t.TempDir()
	service, err := New(root)
	if err != nil {
		t.Fatal(err)
	}
	builtin := systemPlugin(t, service)
	if !builtin.Enabled {
		t.Fatal("system plugins should mount without the user installing anything")
	}
	if len(builtin.Contributes.Tools) == 0 {
		t.Fatalf("system plugin contributes no tools: %#v", builtin)
	}
	// The registry stays untouched: "enabled" for a built-in is a default, not a
	// recorded decision, so a fresh data directory has nothing to write.
	if _, recorded := service.registry.Enabled[builtin.ID]; recorded {
		t.Fatal("publishing a system plugin should not write a registry entry")
	}
	page, err := service.PageHTML(builtin.ID, builtin.Contributes.Tools[0].ID)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(page, "window.nonoka") {
		t.Fatal("system plugin page did not receive the host bridge")
	}
	if _, err := os.Stat(filepath.Join(root, "system-plugins", builtin.ID, currentName)); err != nil {
		t.Fatalf("system plugin was not published to the system root: %v", err)
	}
}

func TestSystemPluginsSurviveRelaunch(t *testing.T) {
	root := t.TempDir()
	first, err := New(root)
	if err != nil {
		t.Fatal(err)
	}
	builtin := systemPlugin(t, first)
	// A second launch against the same data directory must be a no-op rather
	// than a re-extraction, and must not disturb a disable the user chose.
	if _, err := first.SetEnabled(builtin.ID, false); err != nil {
		t.Fatal(err)
	}
	second, err := New(root)
	if err != nil {
		t.Fatal(err)
	}
	relaunched := systemPlugin(t, second)
	if relaunched.Enabled {
		t.Fatal("relaunch re-enabled a system plugin the user disabled")
	}
	if _, err := second.PageHTML(relaunched.ID, relaunched.Contributes.Tools[0].ID); err == nil {
		t.Fatal("a disabled system plugin should not serve its page")
	}
	versions, err := os.ReadDir(filepath.Join(root, "system-plugins", builtin.ID, "versions"))
	if err != nil {
		t.Fatal(err)
	}
	if len(versions) != 1 {
		t.Fatalf("relaunch left %d version directories behind", len(versions))
	}
}

func TestSystemPluginsRepublishWhenEmbeddedContentChanges(t *testing.T) {
	root := t.TempDir()
	first, err := New(root)
	if err != nil {
		t.Fatal(err)
	}
	builtin := systemPlugin(t, first)
	pluginRoot := filepath.Join(root, "system-plugins", builtin.ID)
	page := filepath.Join(pluginRoot, "versions", builtin.Version, "ui", "index.html")
	if _, err := os.Stat(page); err != nil {
		t.Fatal(err)
	}
	original, err := os.ReadFile(page)
	if err != nil {
		t.Fatal(err)
	}
	// Stand in for a rebuild that changed the page without touching the version:
	// the installed copy no longer matches the recorded digest.
	if err := os.WriteFile(page, []byte("<p>stale build</p>"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(pluginRoot, systemDigestName), []byte("stale"), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := New(root); err != nil {
		t.Fatal(err)
	}
	republished, err := os.ReadFile(page)
	if err != nil {
		t.Fatal(err)
	}
	if string(republished) != string(original) {
		t.Fatal("a changed built-in was not republished; the stale page survived the relaunch")
	}
}

func TestSystemPluginsCannotBeUninstalledOrShadowed(t *testing.T) {
	root := t.TempDir()
	service, err := New(root)
	if err != nil {
		t.Fatal(err)
	}
	builtin := systemPlugin(t, service)
	if err := service.Uninstall(builtin.ID, false); err == nil {
		t.Fatal("a system plugin was uninstalled")
	}
	if _, err := os.Stat(filepath.Join(root, "system-plugins", builtin.ID, currentName)); err != nil {
		t.Fatalf("rejected uninstall still removed the system plugin: %v", err)
	}

	// A sideloaded package claiming a built-in id must be refused, otherwise it
	// would inherit the wider capability limits that id is trusted with.
	impostor := filepath.Join(t.TempDir(), "impostor")
	manifest := strings.Replace(testManifest, "dev.nonoka.hello", builtin.ID, 1)
	mustWrite(t, filepath.Join(impostor, manifestName), manifest)
	mustWrite(t, filepath.Join(impostor, "ui", "index.html"), `<p>impostor</p>`)
	if _, err := service.Install(impostor); err == nil {
		t.Fatal("a user package took over a system plugin id")
	}
	if still := systemPlugin(t, service); still.Publisher != builtin.Publisher {
		t.Fatalf("system plugin was replaced: %#v", still)
	}
}
