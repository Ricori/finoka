package plugins

// Cookie jar and PO token provider settings for the built-in downloader.
//
// YouTube only returns usable media formats to a signed-in session whose
// request also carries a GVS proof-of-origin token. That needs two pieces of
// configuration the rest of the plugin API deliberately has no place for: a
// cookie jar, which is account credentials, and the address of a PO token
// provider.
//
// Cookies are write-only as far as the page is concerned. It can install a new
// jar, clear the stored one, and see whether one is configured -- but it can
// never read one back. Passing credentials into a sandboxed iframe would widen
// their exposure without enabling anything the editing flow needs, since
// replacing a jar is how a browser export is applied anyway.

import (
	"errors"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/Ricori/nonoka-x/desktop/internal/managedtools"
)

const (
	cookiesFileName   = "cookies.txt"
	maxCookieJarBytes = 512 << 10
)

type DownloaderSettings struct {
	CookiesPresent bool   `json:"cookiesPresent"`
	CookieCount    int    `json:"cookieCount"`
	CookiesUpdated string `json:"cookiesUpdated,omitempty"`
	// POTReady means every piece of the PO token path is installed. Missing
	// names the runtime resources still absent, by their install id, so the page
	// can tell the user what to install rather than just that something failed.
	POTReady bool     `json:"potReady"`
	Missing  []string `json:"missing"`
	// DownloadRunning lets a freshly mounted page re-attach to a download that
	// started before it existed.
	DownloadRunning bool `json:"downloadRunning"`
}

// LoadDownloaderSettings reports what the downloader is configured with. The
// cookie jar is summarised, never returned.
func (s *Service) LoadDownloaderSettings(pluginID string) (DownloaderSettings, error) {
	if err := s.requireCookieAccess(pluginID); err != nil {
		return DownloaderSettings{}, err
	}
	return s.downloaderSettings(pluginID), nil
}

func (s *Service) SaveCookies(pluginID, content string) (DownloaderSettings, error) {
	if err := s.requireCookieAccess(pluginID); err != nil {
		return DownloaderSettings{}, err
	}
	if _, err := validateCookieJar(content); err != nil {
		return DownloaderSettings{}, err
	}
	path, err := s.pluginDataPath(pluginID, cookiesFileName)
	if err != nil {
		return DownloaderSettings{}, err
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return DownloaderSettings{}, err
	}
	// 0600 because this is an account credential: yt-dlp is the only reader and
	// it runs as the same user.
	if err := os.WriteFile(path, []byte(content), 0o600); err != nil {
		return DownloaderSettings{}, err
	}
	return s.downloaderSettings(pluginID), nil
}

func (s *Service) ClearCookies(pluginID string) (DownloaderSettings, error) {
	if err := s.requireCookieAccess(pluginID); err != nil {
		return DownloaderSettings{}, err
	}
	path, err := s.pluginDataPath(pluginID, cookiesFileName)
	if err != nil {
		return DownloaderSettings{}, err
	}
	if err := os.Remove(path); err != nil && !errors.Is(err, os.ErrNotExist) {
		return DownloaderSettings{}, err
	}
	return s.downloaderSettings(pluginID), nil
}

// requireCookieAccess gates the credential surface on the declared permission
// alone, origin included. What keeps that safe is the shape of the surface
// rather than who is asking: every plugin gets its own jar under its own data
// directory, the page can never read one back, and the sandbox has no network
// to send one to. So the worst a sideloaded plugin can do is use a session the
// user deliberately pasted into it -- and only against the hosts
// validateVideoURL allows, writing only where the save dialog says.
func (s *Service) requireCookieAccess(pluginID string) error {
	_, err := s.requireTrustedPermission(pluginID, "tools.cookies")
	return err
}

func (s *Service) pluginDataPath(pluginID, name string) (string, error) {
	if !pluginIDPattern.MatchString(pluginID) {
		return "", errors.New("invalid plugin id")
	}
	root := filepath.Join(s.dataRoot, pluginID)
	if filepath.Dir(root) != s.dataRoot {
		return "", errors.New("invalid plugin data directory")
	}
	return filepath.Join(root, name), nil
}

func (s *Service) downloaderSettings(pluginID string) DownloaderSettings {
	settings := DownloaderSettings{Missing: []string{}, DownloadRunning: s.downloadActive.Load()}
	_, pluginErr := managedtools.FindPOTPlugin(s.dataDirectory)
	_, generatorErr := managedtools.FindPOTServer(s.dataDirectory)
	if pluginErr != nil || generatorErr != nil {
		// One bundle carries both halves, so a half-extracted install is still
		// just "the provider is not installed" as far as the user can act on it.
		settings.Missing = append(settings.Missing, "pot-provider")
	}
	if jsRuntimeArgs(s.dataDirectory) == nil {
		settings.Missing = append(settings.Missing, "node")
	}
	settings.POTReady = len(settings.Missing) == 0
	path, err := s.pluginDataPath(pluginID, cookiesFileName)
	if err != nil {
		return settings
	}
	info, err := os.Stat(path)
	if err != nil || !info.Mode().IsRegular() {
		return settings
	}
	settings.CookiesPresent = true
	settings.CookiesUpdated = info.ModTime().UTC().Format(time.RFC3339)
	if data, readErr := os.ReadFile(path); readErr == nil {
		settings.CookieCount = countCookieLines(string(data))
	}
	return settings
}

// cookiesFor returns the stored jar's path when one is installed. Used by the
// download capability; it never leaves the Go process.
func (s *Service) cookiesFor(pluginID string) string {
	path, err := s.pluginDataPath(pluginID, cookiesFileName)
	if err != nil {
		return ""
	}
	if info, statErr := os.Stat(path); statErr != nil || !info.Mode().IsRegular() {
		return ""
	}
	return path
}

func countCookieLines(content string) int {
	count := 0
	for _, line := range strings.Split(content, "\n") {
		line = strings.TrimSpace(line)
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		count++
	}
	return count
}

// validateCookieJar checks the paste is a Netscape cookie file rather than, say,
// a page of HTML the user copied by mistake. The shape check is what turns a bad
// paste into a message at save time instead of a download failure minutes later.
func validateCookieJar(content string) (int, error) {
	if len(content) > maxCookieJarBytes {
		return 0, errors.New("cookie file is too large")
	}
	if strings.TrimSpace(content) == "" {
		return 0, errors.New("cookie file is empty")
	}
	entries := 0
	for _, line := range strings.Split(content, "\n") {
		trimmed := strings.TrimSpace(line)
		if trimmed == "" || strings.HasPrefix(trimmed, "#") {
			continue
		}
		// Netscape jars carry seven tab-separated fields per entry.
		if fields := strings.Split(strings.TrimRight(line, "\r"), "\t"); len(fields) >= 7 {
			entries++
			continue
		}
		return 0, errors.New("this does not look like a Netscape cookies.txt file; export it with a cookies.txt browser extension")
	}
	if entries == 0 {
		return 0, errors.New("no cookies found in the file")
	}
	return entries, nil
}
