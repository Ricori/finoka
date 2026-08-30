package plugins

import (
	"bytes"
	"errors"
	"fmt"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"strings"

	"github.com/Ricori/finoka/desktop/internal/library"
	"github.com/Ricori/finoka/desktop/internal/managedtools"
)

type MediaSummary struct {
	ID                string  `json:"id"`
	Title             string  `json:"title"`
	Duration          float64 `json:"duration"`
	Width             int     `json:"width"`
	Height            int     `json:"height"`
	Available         bool    `json:"available"`
	DocumentAvailable bool    `json:"documentAvailable"`
}

type ExportedArtifact struct {
	Path   string `json:"path"`
	Format string `json:"format"`
	Size   int64  `json:"size"`
}

type DownloadedMedia struct {
	Platform   string       `json:"platform"`
	OutputPath string       `json:"outputPath"`
	Media      MediaSummary `json:"media"`
}

func (s *Service) MediaList(pluginID string) ([]MediaSummary, error) {
	if err := s.requirePermission(pluginID, "media.list"); err != nil {
		return nil, err
	}
	s.mu.RLock()
	media := s.media
	s.mu.RUnlock()
	if media == nil {
		return nil, errors.New("media library is unavailable")
	}
	entries := media.List()
	result := make([]MediaSummary, 0, len(entries))
	for _, entry := range entries {
		result = append(result, summarizeMedia(entry))
	}
	return result, nil
}

// ExportAudio is a structured FFmpeg capability. Plugins select a Finoka media
// ID and an output format; the host owns input resolution, arguments, the save
// dialog, temporary files, and final publication.
func (s *Service) ExportAudio(pluginID, mediaID, format string) (ExportedArtifact, error) {
	if err := s.requirePermission(pluginID, "ffmpeg.extract-audio"); err != nil {
		return ExportedArtifact{}, err
	}
	if !s.mediaJobMu.TryLock() {
		return ExportedArtifact{}, errors.New("another plugin media export is already running")
	}
	defer s.mediaJobMu.Unlock()
	s.mu.RLock()
	media, app, home := s.media, s.app, s.home
	s.mu.RUnlock()
	if media == nil || app == nil || home == nil {
		return ExportedArtifact{}, errors.New("application media services are unavailable")
	}
	entry, err := media.Get(mediaID)
	if err != nil {
		return ExportedArtifact{}, err
	}
	input, err := filepath.Abs(entry.SourcePath)
	if err != nil {
		return ExportedArtifact{}, err
	}
	if info, statErr := os.Stat(input); statErr != nil || !info.Mode().IsRegular() {
		return ExportedArtifact{}, errors.New("local media is unavailable")
	}

	format = strings.ToLower(strings.TrimSpace(format))
	extension, label, args, err := audioFormat(format)
	if err != nil {
		return ExportedArtifact{}, err
	}
	base := strings.TrimSuffix(filepath.Base(entry.Title), filepath.Ext(entry.Title))
	if strings.TrimSpace(base) == "" || base == "." {
		base = "audio"
	}
	output, err := app.Dialog.SaveFile().
		SetFilename(base+extension).
		AddFilter(label, "*"+extension).
		AttachToWindow(home).
		PromptForSingleSelection()
	if err != nil && !dialogCancelled(err) {
		return ExportedArtifact{}, err
	}
	if output == "" {
		return ExportedArtifact{}, nil
	}
	if !strings.EqualFold(filepath.Ext(output), extension) {
		output += extension
	}
	output, err = filepath.Abs(output)
	if err != nil {
		return ExportedArtifact{}, err
	}
	if samePath(input, output) {
		return ExportedArtifact{}, errors.New("audio export may not overwrite the source media")
	}

	ffmpeg, err := managedtools.Find(s.dataDirectory, "ffmpeg")
	if err != nil {
		return ExportedArtifact{}, errors.New("Finoka FFmpeg is not installed")
	}
	partial := strings.TrimSuffix(output, extension) + ".part" + extension
	_ = os.Remove(partial)
	commandArgs := []string{"-v", "error", "-y", "-i", input, "-vn"}
	commandArgs = append(commandArgs, args...)
	commandArgs = append(commandArgs, partial)
	command := exec.Command(ffmpeg, commandArgs...)
	configurePluginCommand(command)
	var stderr bytes.Buffer
	command.Stderr = &stderr
	if err := command.Run(); err != nil {
		_ = os.Remove(partial)
		detail := strings.TrimSpace(stderr.String())
		if detail == "" {
			detail = err.Error()
		}
		if len(detail) > 4_000 {
			detail = detail[len(detail)-4_000:]
		}
		return ExportedArtifact{}, fmt.Errorf("FFmpeg audio export failed: %s", detail)
	}
	if err := os.Rename(partial, output); err != nil {
		_ = os.Remove(partial)
		return ExportedArtifact{}, err
	}
	info, err := os.Stat(output)
	if err != nil {
		return ExportedArtifact{}, err
	}
	return ExportedArtifact{Path: output, Format: format, Size: info.Size()}, nil
}

// RunYTDLP executes plugin-supplied yt-dlp arguments from a closed safe set for
// public YouTube and Twitch URLs. The host still owns tool resolution, the
// output path, FFmpeg wiring and the final media-library import.
func (s *Service) RunYTDLP(pluginID, rawURL string, pluginArgs []string) (DownloadedMedia, error) {
	if err := s.requirePermission(pluginID, "tools.yt-dlp"); err != nil {
		return DownloadedMedia{}, err
	}
	if err := s.requirePermission(pluginID, "media.import"); err != nil {
		return DownloadedMedia{}, err
	}
	platform, normalizedURL, err := validateVideoURL(rawURL)
	if err != nil {
		return DownloadedMedia{}, err
	}
	if err := validateYTDLPArguments(pluginArgs); err != nil {
		return DownloadedMedia{}, err
	}
	if !s.mediaJobMu.TryLock() {
		return DownloadedMedia{}, errors.New("another plugin media job is already running")
	}
	defer s.mediaJobMu.Unlock()

	s.mu.RLock()
	media, app, home := s.media, s.app, s.home
	s.mu.RUnlock()
	if media == nil || app == nil || home == nil {
		return DownloadedMedia{}, errors.New("application media services are unavailable")
	}
	output, err := app.Dialog.SaveFile().
		SetFilename(platform+"-video.mp4").
		AddFilter("MP4 视频", "*.mp4").
		AttachToWindow(home).
		PromptForSingleSelection()
	if err != nil && !dialogCancelled(err) {
		return DownloadedMedia{}, err
	}
	if output == "" {
		return DownloadedMedia{}, nil
	}
	if !strings.EqualFold(filepath.Ext(output), ".mp4") {
		output += ".mp4"
	}
	output, err = filepath.Abs(output)
	if err != nil {
		return DownloadedMedia{}, err
	}
	if err := os.MkdirAll(filepath.Dir(output), 0o755); err != nil {
		return DownloadedMedia{}, err
	}

	ytDLP, ytDLPPrefix, err := managedtools.FindYTDLP(s.dataDirectory)
	if err != nil {
		return DownloadedMedia{}, err
	}
	ffmpeg, err := managedtools.Find(s.dataDirectory, "ffmpeg")
	if err != nil {
		return DownloadedMedia{}, errors.New("Finoka FFmpeg is not installed; install it from 运行环境 first")
	}
	args := append([]string(nil), ytDLPPrefix...)
	args = append(args, pluginArgs...)

	args = append(args,
		"--no-playlist",
		"--newline",
		"--force-overwrites",
		"--ffmpeg-location", filepath.Dir(ffmpeg),
		"--merge-output-format", "mp4",
		"--remux-video", "mp4",
	)
	args = append(args, "-o", output, normalizedURL)
	command := exec.Command(ytDLP, args...)
	configurePluginCommand(command)
	outputLog := newTailBuffer(8_000)
	command.Stdout = &outputLog
	command.Stderr = &outputLog
	if err := command.Run(); err != nil {
		detail := strings.TrimSpace(outputLog.String())
		if detail == "" {
			detail = err.Error()
		}
		return DownloadedMedia{}, fmt.Errorf("yt-dlp download failed: %s", detail)
	}
	info, err := os.Stat(output)
	if err != nil || !info.Mode().IsRegular() || info.Size() == 0 {
		return DownloadedMedia{}, errors.New("yt-dlp completed without producing the selected MP4 file")
	}
	imported := media.Import([]string{output})
	if len(imported.Failed) > 0 {
		return DownloadedMedia{}, fmt.Errorf("video was downloaded to %s but media import failed: %s", output, imported.Failed[0].Message)
	}
	var entrySummary MediaSummary
	for _, entry := range media.List() {
		absolute, absoluteErr := filepath.Abs(entry.SourcePath)
		if absoluteErr == nil && samePath(absolute, output) {
			entrySummary = summarizeMedia(entry)
			break
		}
	}
	if entrySummary.ID == "" {
		return DownloadedMedia{}, fmt.Errorf("video was downloaded to %s but could not be found in the media library", output)
	}
	return DownloadedMedia{Platform: platform, OutputPath: output, Media: entrySummary}, nil
}

func (s *Service) requirePermission(pluginID, permission string) error {
	if !pluginIDPattern.MatchString(pluginID) {
		return errors.New("invalid plugin id")
	}
	s.mu.RLock()
	defer s.mu.RUnlock()
	if !s.registry.Enabled[pluginID] {
		return errors.New("plugin is disabled")
	}
	manifest, _, err := s.installedManifestLocked(pluginID)
	if err != nil {
		return err
	}
	for _, granted := range manifest.Permissions {
		if granted == permission {
			return nil
		}
	}
	return fmt.Errorf("plugin does not have %s permission", permission)
}

func audioFormat(format string) (extension, label string, args []string, err error) {
	switch format {
	case "wav":
		return ".wav", "WAV 音频", []string{"-c:a", "pcm_s16le"}, nil
	case "flac":
		return ".flac", "FLAC 音频", []string{"-c:a", "flac"}, nil
	case "mp3":
		return ".mp3", "MP3 音频", []string{"-c:a", "libmp3lame", "-q:a", "2"}, nil
	case "m4a":
		return ".m4a", "M4A 音频", []string{"-c:a", "aac", "-b:a", "192k"}, nil
	default:
		return "", "", nil, errors.New("audio format must be wav, flac, mp3, or m4a")
	}
}

func validateVideoURL(raw string) (platform, normalized string, err error) {
	if len(raw) > 2_048 {
		return "", "", errors.New("video URL is too long")
	}
	parsed, err := url.Parse(strings.TrimSpace(raw))
	if err != nil || parsed.Scheme != "https" || parsed.Hostname() == "" || parsed.User != nil {
		return "", "", errors.New("enter a valid HTTPS YouTube or Twitch URL")
	}
	host := strings.ToLower(strings.TrimSuffix(parsed.Hostname(), "."))
	switch {
	case host == "youtu.be" || host == "youtube.com" || strings.HasSuffix(host, ".youtube.com"):
		platform = "youtube"
	case host == "twitch.tv" || strings.HasSuffix(host, ".twitch.tv"):
		platform = "twitch"
	default:
		return "", "", errors.New("only YouTube and Twitch URLs are supported")
	}
	return platform, parsed.String(), nil
}

func validateYTDLPArguments(arguments []string) error {
	if len(arguments) > 32 {
		return errors.New("yt-dlp command contains too many arguments")
	}
	formatValues := map[string]bool{
		"bv*+ba/b":                             true,
		"bv*[height<=1080]+ba/b[height<=1080]": true,
		"bv*[height<=720]+ba/b[height<=720]":   true,
	}
	for index := 0; index < len(arguments); index++ {
		argument := arguments[index]
		if argument == "" || len(argument) > 512 {
			return errors.New("yt-dlp command contains an invalid argument")
		}
		switch argument {
		case "--no-playlist", "--newline", "--embed-metadata":
			continue
		case "-f", "--format", "--merge-output-format", "--remux-video", "-N", "--concurrent-fragments":
			if index+1 >= len(arguments) {
				return fmt.Errorf("yt-dlp argument %s requires a value", argument)
			}
			value := arguments[index+1]
			index++
			switch argument {
			case "-f", "--format":
				if !formatValues[value] {
					return errors.New("yt-dlp format selector is not allowed")
				}
			case "--merge-output-format", "--remux-video":
				if value != "mp4" {
					return errors.New("yt-dlp demo output format must be mp4")
				}
			case "-N", "--concurrent-fragments":
				if value != "1" && value != "2" && value != "4" && value != "8" {
					return errors.New("yt-dlp concurrent fragments must be 1, 2, 4, or 8")
				}
			}
		default:
			return fmt.Errorf("yt-dlp argument %q is not allowed for UI plugins", argument)
		}
	}
	return nil
}

func summarizeMedia(entry library.Entry) MediaSummary {
	return MediaSummary{
		ID:                entry.ID,
		Title:             entry.Title,
		Duration:          entry.Duration,
		Width:             entry.Width,
		Height:            entry.Height,
		Available:         entry.Available,
		DocumentAvailable: entry.DocumentAvailable,
	}
}

func samePath(left, right string) bool {
	left = filepath.Clean(left)
	right = filepath.Clean(right)
	if filepath.Separator == '\\' {
		return strings.EqualFold(left, right)
	}
	return left == right
}

type tailBuffer struct {
	data  []byte
	limit int
}

func newTailBuffer(limit int) tailBuffer {
	return tailBuffer{data: make([]byte, 0, limit), limit: limit}
}

func (b *tailBuffer) Write(value []byte) (int, error) {
	written := len(value)
	if b.limit <= 0 {
		return written, nil
	}
	b.data = append(b.data, value...)
	if len(b.data) > b.limit {
		copy(b.data, b.data[len(b.data)-b.limit:])
		b.data = b.data[:b.limit]
	}
	return written, nil
}

func (b *tailBuffer) String() string { return string(b.data) }
