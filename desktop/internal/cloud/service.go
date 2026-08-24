// Package cloud owns Finoka account login, the remote library and safe local-artifact sync.
package cloud

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
	"time"
	"unicode/utf8"

	"github.com/Ricori/finoka/desktop/internal/library"
	"github.com/Ricori/finoka/desktop/internal/managedtools"
)

const (
	maxResponseBytes = 16 << 20
	maxArtifactBytes = 32 << 20
)

var validTaskID = regexp.MustCompile(`^[0-9a-f]{32}$`)
var validCloudTaskID = regexp.MustCompile(`^vid_[0-9a-f]{24}$`)
var validUploadID = regexp.MustCompile(`^upl_[0-9a-f]{32}$`)
var validLocalMediaID = regexp.MustCompile(`^loc_[0-9a-f]{12}$`)
var validKeyID = regexp.MustCompile(`^key_[0-9a-f]{64}$`)

type providerCaller interface {
	DoJSON(context.Context, string, string, any, any) error
}

type mediaResolver interface {
	ResolveMedia(string) (path, title, fingerprint string, duration float64, err error)
}

type Session struct {
	Authenticated bool   `json:"authenticated"`
	Backend       string `json:"backend,omitempty"`
	Admin         bool   `json:"admin,omitempty"`
	Name          string `json:"name,omitempty"`
	Remaining     *int   `json:"remaining,omitempty"`
	Running       int    `json:"running"`
	Synced        int    `json:"synced,omitempty"`
	SyncSkipped   int    `json:"syncSkipped,omitempty"`
	SyncFailed    int    `json:"syncFailed,omitempty"`
	CloudVideos   int    `json:"cloudVideos,omitempty"`
	SyncError     string `json:"syncError,omitempty"`
}

type Entry struct {
	ID           string  `json:"id"`
	Title        string  `json:"title"`
	Fingerprint  string  `json:"fingerprint"`
	Duration     float64 `json:"duration"`
	Status       string  `json:"status"`
	Source       string  `json:"source"`
	EngineCommit string  `json:"engineCommit,omitempty"`
	CreatedAt    string  `json:"createdAt"`
	UpdatedAt    string  `json:"updatedAt"`
	OwnerID      string  `json:"ownerId,omitempty"`
	OwnerName    string  `json:"ownerName,omitempty"`
}

type AdminKey struct {
	ID         string `json:"id"`
	Name       string `json:"name"`
	Key        string `json:"key"`
	KeyPreview string `json:"keyPreview"`
	Remaining  int    `json:"remaining"`
	Submitted  int    `json:"submitted,omitempty"`
	Running    int    `json:"running,omitempty"`
	CreatedAt  string `json:"createdAt,omitempty"`
}

type IssuedAdminKey struct {
	AdminKey
	Key       string `json:"key"`
	Generated bool   `json:"generated"`
}

type syncRequest struct {
	LocalID      string            `json:"localId"`
	Fingerprint  string            `json:"fingerprint"`
	Title        string            `json:"title"`
	Duration     float64           `json:"duration"`
	TaskID       string            `json:"taskId"`
	EngineCommit string            `json:"engineCommit"`
	Artifacts    map[string]string `json:"artifacts"`
}

type storedSession struct {
	Backend string `json:"backend"`
	Key     string `json:"key"`
}

type artifactManifest struct {
	TaskID       string `json:"task_id"`
	EngineCommit string `json:"engine_commit"`
	Artifacts    map[string]struct {
		URI string `json:"uri"`
	} `json:"artifacts"`
}

type remoteArtifactManifest struct {
	Schema       int    `json:"schema"`
	TaskID       string `json:"task_id"`
	EngineCommit string `json:"engine_commit"`
	Artifacts    map[string]struct {
		URI    string `json:"uri"`
		SHA256 string `json:"sha256"`
		Bytes  int64  `json:"bytes"`
	} `json:"artifacts"`
}

type taskLink struct {
	LocalID string `json:"localId"`
}

type Service struct {
	mu         sync.RWMutex
	syncMu     sync.Mutex
	configPath string
	linksPath  string
	root       string
	tasksRoot  string
	provider   providerCaller
	media      mediaResolver
	client     *http.Client
	upload     *http.Client
	extractor  func(context.Context, string, string) error
	session    storedSession
	links      map[string]taskLink
}

func New(dataDirectory string, provider providerCaller, resolvers ...mediaResolver) (*Service, error) {
	if provider == nil {
		return nil, errors.New("local provider is required")
	}
	root, err := filepath.Abs(dataDirectory)
	if err != nil {
		return nil, err
	}
	service := &Service{
		configPath: filepath.Join(root, "cloud-session.json"),
		linksPath:  filepath.Join(root, "cloud-tasks.json"),
		root:       root,
		tasksRoot:  filepath.Join(root, "tasks"),
		provider:   provider,
		client:     &http.Client{Timeout: 30 * time.Second},
		upload:     &http.Client{Timeout: 3 * time.Hour},
		extractor: func(ctx context.Context, source, output string) error {
			return extractAudioWithRoot(ctx, root, source, output)
		},
		links: map[string]taskLink{},
	}
	if len(resolvers) > 0 {
		service.media = resolvers[0]
	}
	if err := service.load(); err != nil {
		return nil, err
	}
	return service, nil
}

func (s *Service) Capabilities() (map[string]any, error) {
	var result map[string]any
	err := s.authenticatedDo(context.Background(), http.MethodGet, "/v1/capabilities", nil, &result)
	return result, err
}

func (s *Service) StartTask(localID string, options map[string]any) (map[string]any, error) {
	if s.media == nil {
		return nil, errors.New("media library is unavailable")
	}
	path, title, fingerprint, duration, err := s.media.ResolveMedia(localID)
	if err != nil {
		return nil, err
	}
	if duration <= 0 || duration > 2*time.Hour.Seconds() {
		return nil, errors.New("cloud audio duration must be between 0 and 2 hours")
	}
	uploadRoot := filepath.Join(s.root, "cloud-uploads")
	if err := os.MkdirAll(uploadRoot, 0o700); err != nil {
		return nil, err
	}
	work, err := os.MkdirTemp(uploadRoot, "task-")
	if err != nil {
		return nil, err
	}
	defer os.RemoveAll(work)
	audio := filepath.Join(work, "source.m4a")
	if err := s.extractor(context.Background(), path, audio); err != nil {
		return nil, err
	}
	stat, err := os.Stat(audio)
	if err != nil {
		return nil, err
	}
	var initialized struct {
		ObjectID    string `json:"objectId"`
		UploadURL   string `json:"uploadUrl"`
		ContentType string `json:"contentType"`
	}
	if err := s.authenticatedDo(context.Background(), http.MethodPost, "/v1/uploads/init", map[string]any{"filename": filepath.Base(path) + ".m4a", "bytes": stat.Size()}, &initialized); err != nil {
		return nil, err
	}
	if !validUploadID.MatchString(initialized.ObjectID) {
		return nil, errors.New("cloud returned an invalid upload object id")
	}
	if err := s.putAudio(context.Background(), initialized.UploadURL, initialized.ContentType, audio, stat.Size()); err != nil {
		s.abortUpload(initialized.ObjectID)
		return nil, err
	}
	target := "final-srt"
	if value, ok := options["target"].(string); ok && value == "raw-srt" {
		target = value
	}
	request := map[string]any{
		"schema":               1,
		"provider":             "cloud",
		"source":               map[string]any{"kind": "uploaded_audio", "object_id": initialized.ObjectID, "title": title, "fingerprint": fingerprint, "duration": duration},
		"target":               target,
		"language":             stringOption(options, "language", "ja"),
		"device":               "cuda",
		"gpu_budget_gb":        numberOption(options, "gpu_budget_gb", 8),
		"correction":           map[string]any{"enabled": target == "final-srt", "media": "text", "retrieval": "none", "difficulty": "quality", "fast": "auto", "extra_info": "", "extra_style": ""},
		"knowledge":            stringOption(options, "knowledge", "update"),
		"cleanup_intermediate": false,
	}
	if correction, ok := options["correction"].(map[string]any); ok {
		cleaned := request["correction"].(map[string]any)
		for _, key := range []string{"difficulty", "fast", "extra_info", "extra_style"} {
			if value, exists := correction[key]; exists {
				cleaned[key] = value
			}
		}
	}
	var snapshot map[string]any
	if err := s.authenticatedDo(context.Background(), http.MethodPost, "/v1/tasks", request, &snapshot); err != nil {
		s.abortUpload(initialized.ObjectID)
		return nil, err
	}
	taskID, _ := snapshot["task_id"].(string)
	if !validCloudTaskID.MatchString(taskID) {
		return nil, errors.New("cloud returned an invalid task id")
	}
	s.mu.Lock()
	s.links[taskID] = taskLink{LocalID: localID}
	err = s.saveLinksLocked()
	s.mu.Unlock()
	if err != nil {
		return nil, err
	}
	return snapshot, nil
}

func (s *Service) abortUpload(objectID string) {
	if !validUploadID.MatchString(objectID) {
		return
	}
	_ = s.authenticatedDo(context.Background(), http.MethodDelete, "/v1/uploads/"+objectID, nil, nil)
}

func (s *Service) TaskStatus(taskID string) (map[string]any, error) {
	return s.taskGet(taskID, "")
}

func (s *Service) ListTasks() (map[string]any, error) {
	var result map[string]any
	err := s.authenticatedDo(context.Background(), http.MethodGet, "/v1/tasks?limit=100", nil, &result)
	if err != nil {
		return nil, err
	}
	s.mu.RLock()
	links := make(map[string]taskLink, len(s.links))
	for taskID, link := range s.links {
		links[taskID] = link
	}
	s.mu.RUnlock()
	if tasks, ok := result["tasks"].([]any); ok {
		for _, value := range tasks {
			record, ok := value.(map[string]any)
			if !ok {
				continue
			}
			snapshot, _ := record["snapshot"].(map[string]any)
			taskID, _ := snapshot["task_id"].(string)
			if link, exists := links[taskID]; exists {
				record["media_id"] = link.LocalID
			}
		}
	}
	return result, nil
}

func (s *Service) TaskEvents(taskID string, afterCursor int) (map[string]any, error) {
	if afterCursor < 0 {
		return nil, errors.New("event cursor must not be negative")
	}
	return s.taskGet(taskID, "events?after="+fmt.Sprint(afterCursor))
}

func (s *Service) CancelTask(taskID string) (map[string]any, error) {
	return s.taskAction(taskID, "cancel")
}

func (s *Service) RetryTask(taskID string) (map[string]any, error) {
	return s.taskAction(taskID, "retry")
}

func (s *Service) ResumeTask(taskID string) (map[string]any, error) {
	return s.taskAction(taskID, "resume")
}

func (s *Service) TaskArtifacts(taskID string) (map[string]any, error) {
	if !validCloudTaskID.MatchString(taskID) {
		return nil, errors.New("invalid cloud task id")
	}
	s.mu.RLock()
	link, exists := s.links[taskID]
	s.mu.RUnlock()
	if !exists || s.media == nil {
		return nil, errors.New("cloud task has no local media link")
	}
	path, title, fingerprint, duration, err := s.media.ResolveMedia(link.LocalID)
	if err != nil {
		return nil, err
	}
	var remote remoteArtifactManifest
	if err := s.authenticatedDo(context.Background(), http.MethodGet, "/v1/tasks/"+taskID+"/artifacts", nil, &remote); err != nil {
		return nil, err
	}
	directory := filepath.Join(s.tasksRoot, "cloud", taskID)
	if err := os.MkdirAll(directory, 0o700); err != nil {
		return nil, err
	}
	contents := map[string]string{}
	local := map[string]any{}
	total := int64(0)
	for _, name := range []string{"stable_json", "raw_srt", "annotated_csv", "final_srt"} {
		item, ok := remote.Artifacts[name]
		if !ok {
			continue
		}
		content, err := s.authenticatedText(context.Background(), item.URI)
		if err != nil {
			return nil, err
		}
		total += int64(len(content))
		if total > maxArtifactBytes {
			return nil, errors.New("cloud artifacts exceed the 32 MB limit")
		}
		digest := sha256.Sum256(content)
		actualSHA := hex.EncodeToString(digest[:])
		if len(item.SHA256) != 64 || !strings.EqualFold(actualSHA, item.SHA256) {
			return nil, fmt.Errorf("cloud artifact %s failed SHA-256 verification", name)
		}
		contents[name] = string(content)
		suffixes := map[string]string{"stable_json": ".stable.json", "raw_srt": ".raw.srt", "annotated_csv": ".annotated.csv", "final_srt": ".srt"}
		artifactPath := filepath.Join(directory, name+suffixes[name])
		temporary, err := os.CreateTemp(directory, "."+name+"-*.part")
		if err != nil {
			return nil, err
		}
		temporaryName := temporary.Name()
		if err := temporary.Chmod(0o600); err == nil {
			_, err = temporary.Write(content)
		}
		closeErr := temporary.Close()
		if err == nil {
			err = closeErr
		}
		if err == nil {
			err = os.Rename(temporaryName, artifactPath)
		}
		if err != nil {
			_ = os.Remove(temporaryName)
			return nil, err
		}
		local[name] = map[string]any{"uri": localFileURI(artifactPath), "sha256": actualSHA, "bytes": len(content)}
	}
	if len(contents) == 0 {
		return nil, errors.New("cloud task returned no subtitle artifacts")
	}
	projection := map[string]any{"video_id": link.LocalID, "task_id": taskID, "engine_commit": remote.EngineCommit, "title": title, "fingerprint": fingerprint, "duration": duration, "source_path": path, "artifacts": contents}
	var document map[string]any
	if err := s.provider.DoJSON(context.Background(), http.MethodPost, "/v1/documents/project", projection, &document); err != nil {
		return nil, err
	}
	return map[string]any{"schema": 1, "task_id": taskID, "engine_commit": remote.EngineCommit, "artifacts": local}, nil
}

func localFileURI(path string) string {
	value := filepath.ToSlash(path)
	if filepath.VolumeName(path) != "" && !strings.HasPrefix(value, "/") {
		value = "/" + value
	}
	return (&url.URL{Scheme: "file", Path: value}).String()
}

func (s *Service) taskGet(taskID, suffix string) (map[string]any, error) {
	if !validCloudTaskID.MatchString(taskID) {
		return nil, errors.New("invalid cloud task id")
	}
	endpoint := "/v1/tasks/" + taskID
	if suffix != "" {
		endpoint += "/" + suffix
	}
	var result map[string]any
	err := s.authenticatedDo(context.Background(), http.MethodGet, endpoint, nil, &result)
	return result, err
}

func (s *Service) taskAction(taskID, action string) (map[string]any, error) {
	if !validCloudTaskID.MatchString(taskID) {
		return nil, errors.New("invalid cloud task id")
	}
	var result map[string]any
	err := s.authenticatedDo(context.Background(), http.MethodPost, "/v1/tasks/"+taskID+"/"+action, map[string]any{}, &result)
	return result, err
}

func (s *Service) Session() Session {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return Session{Authenticated: s.session.Key != "", Backend: s.session.Backend}
}

func (s *Service) RefreshSession() (Session, error) {
	s.mu.RLock()
	stored := s.session
	s.mu.RUnlock()
	if stored.Backend == "" || stored.Key == "" {
		return Session{Authenticated: false}, nil
	}
	var result Session
	if err := s.do(context.Background(), stored, http.MethodGet, "/v1/session", nil, &result); err != nil {
		return Session{}, err
	}
	result.Authenticated = true
	result.Backend = stored.Backend
	s.mergeLocalLibrary(&result)
	return result, nil
}

func (s *Service) Login(backend, key string) (Session, error) {
	resolved, err := validBackend(backend)
	if err != nil {
		return Session{}, err
	}
	key = strings.TrimSpace(key)
	if key == "" || len(key) > 256 {
		return Session{}, errors.New("cloud key must contain 1 to 256 characters")
	}
	var result Session
	if err := s.do(context.Background(), storedSession{Backend: resolved, Key: key}, http.MethodGet, "/v1/session", nil, &result); err != nil {
		return Session{}, err
	}
	result.Authenticated = true
	result.Backend = resolved
	s.mu.Lock()
	previous := s.session
	s.session = storedSession{Backend: resolved, Key: key}
	if err := s.saveLocked(); err != nil {
		s.session = previous
		s.mu.Unlock()
		return Session{}, err
	}
	s.mu.Unlock()
	s.mergeLocalLibrary(&result)
	return result, nil
}

func (s *Service) Logout() error {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.session = storedSession{}
	if err := os.Remove(s.configPath); err != nil && !errors.Is(err, os.ErrNotExist) {
		return err
	}
	return nil
}

func (s *Service) Library() ([]Entry, error) {
	var envelope struct {
		Videos []Entry `json:"videos"`
	}
	if err := s.authenticatedDo(context.Background(), http.MethodGet, "/v1/library", nil, &envelope); err != nil {
		return nil, err
	}
	if envelope.Videos == nil {
		envelope.Videos = []Entry{}
	}
	return envelope.Videos, nil
}

func (s *Service) DeleteLibraryEntry(identifier string) error {
	if !validCloudTaskID.MatchString(identifier) {
		return errors.New("invalid cloud library entry id")
	}
	return s.authenticatedDo(context.Background(), http.MethodDelete, "/v1/library/"+identifier, nil, nil)
}

func (s *Service) AdminKeys() ([]AdminKey, error) {
	var envelope struct {
		Keys []AdminKey `json:"keys"`
	}
	if err := s.authenticatedDo(context.Background(), http.MethodGet, "/v1/admin/keys", nil, &envelope); err != nil {
		return nil, err
	}
	if envelope.Keys == nil {
		envelope.Keys = []AdminKey{}
	}
	return envelope.Keys, nil
}

func (s *Service) CreateAdminKey(name, key string, remaining int) (IssuedAdminKey, error) {
	name = strings.TrimSpace(name)
	key = strings.TrimSpace(key)
	if name == "" || utf8.RuneCountInString(name) > 100 {
		return IssuedAdminKey{}, errors.New("key name must contain 1 to 100 characters")
	}
	if key == "" || len(key) > 256 {
		return IssuedAdminKey{}, errors.New("custom key must contain 1 to 256 characters")
	}
	if remaining < 0 || remaining > 1_000_000 {
		return IssuedAdminKey{}, errors.New("remaining must be between 0 and 1000000")
	}
	var result IssuedAdminKey
	err := s.authenticatedDo(context.Background(), http.MethodPost, "/v1/admin/keys", map[string]any{
		"name": name, "key": key, "remaining": remaining,
	}, &result)
	return result, err
}

func (s *Service) UpdateAdminKey(identifier, name string, remaining int) (AdminKey, error) {
	name = strings.TrimSpace(name)
	if !validKeyID.MatchString(identifier) {
		return AdminKey{}, errors.New("invalid key id")
	}
	if name == "" || utf8.RuneCountInString(name) > 100 {
		return AdminKey{}, errors.New("key name must contain 1 to 100 characters")
	}
	if remaining < 0 || remaining > 1_000_000 {
		return AdminKey{}, errors.New("remaining must be between 0 and 1000000")
	}
	var result AdminKey
	err := s.authenticatedDo(context.Background(), http.MethodPut, "/v1/admin/keys/"+identifier, map[string]any{
		"name": name, "remaining": remaining,
	}, &result)
	return result, err
}

func (s *Service) DeleteAdminKey(identifier string) error {
	if !validKeyID.MatchString(identifier) {
		return errors.New("invalid key id")
	}
	return s.authenticatedDo(context.Background(), http.MethodDelete, "/v1/admin/keys/"+identifier, nil, nil)
}

// SyncLocalTask reads only artifacts reported by the Local Provider and only
// when their resolved paths remain under Finoka's task root.
func (s *Service) SyncLocalTask(taskID, localID, fingerprint, title string, duration float64) (Entry, error) {
	if !validTaskID.MatchString(taskID) {
		return Entry{}, errors.New("invalid local task id")
	}
	if strings.TrimSpace(fingerprint) == "" || len(fingerprint) > 256 {
		return Entry{}, errors.New("media fingerprint is required")
	}
	var manifest artifactManifest
	endpoint := "/v1/tasks/" + taskID + "/artifacts"
	if err := s.provider.DoJSON(context.Background(), http.MethodGet, endpoint, nil, &manifest); err != nil {
		return Entry{}, err
	}
	manifest.TaskID = taskID
	return s.syncArtifactManifest(manifest, localID, fingerprint, title, duration)
}

func (s *Service) syncArtifactManifest(manifest artifactManifest, localID, fingerprint, title string, duration float64) (Entry, error) {
	if !validTaskID.MatchString(manifest.TaskID) {
		return Entry{}, errors.New("invalid local task id in artifact manifest")
	}
	contents := map[string]string{}
	total := int64(0)
	for _, name := range []string{"stable_json", "raw_srt", "annotated_csv", "final_srt"} {
		item, ok := manifest.Artifacts[name]
		if !ok {
			continue
		}
		path, err := s.safeArtifactPath(item.URI)
		if err != nil {
			return Entry{}, fmt.Errorf("%s: %w", name, err)
		}
		data, err := os.ReadFile(path)
		if err != nil {
			return Entry{}, err
		}
		total += int64(len(data))
		if total > maxArtifactBytes {
			return Entry{}, errors.New("local task artifacts exceed the sync limit")
		}
		contents[name] = string(data)
	}
	if len(contents) == 0 {
		return Entry{}, errors.New("local task has no syncable artifacts")
	}
	request := syncRequest{
		LocalID: localID, Fingerprint: fingerprint, Title: strings.TrimSpace(title), Duration: duration,
		TaskID: manifest.TaskID, EngineCommit: manifest.EngineCommit, Artifacts: contents,
	}
	var result Entry
	if err := s.authenticatedDo(context.Background(), http.MethodPost, "/v1/library/sync", request, &result); err != nil {
		return Entry{}, err
	}
	return result, nil
}

// mergeLocalLibrary uploads completed local subtitle artifacts that are not
// already represented by the authenticated key's remote fingerprint set. It
// never uploads source video and does not spend cloud task quota.
func (s *Service) mergeLocalLibrary(session *Session) {
	catalog, ok := s.media.(interface{ List() []library.Entry })
	if !ok {
		return
	}
	s.syncMu.Lock()
	defer s.syncMu.Unlock()
	remote, err := s.Library()
	if err != nil {
		session.SyncError = err.Error()
		return
	}
	remoteFingerprints := make(map[string]struct{}, len(remote))
	for _, entry := range remote {
		if entry.Fingerprint != "" {
			remoteFingerprints[entry.Fingerprint] = struct{}{}
		}
	}
	for _, entry := range catalog.List() {
		if !entry.DocumentAvailable || entry.Fingerprint == "" || !validLocalMediaID.MatchString(entry.ID) {
			continue
		}
		if _, exists := remoteFingerprints[entry.Fingerprint]; exists {
			session.SyncSkipped++
			continue
		}
		data, readErr := os.ReadFile(filepath.Join(s.root, "documents", entry.ID, "artifacts.json"))
		if readErr != nil {
			session.SyncFailed++
			continue
		}
		var manifest artifactManifest
		if json.Unmarshal(data, &manifest) != nil || !validTaskID.MatchString(manifest.TaskID) {
			session.SyncFailed++
			continue
		}
		if _, syncErr := s.syncArtifactManifest(manifest, entry.ID, entry.Fingerprint, entry.Title, entry.Duration); syncErr != nil {
			session.SyncFailed++
			continue
		}
		remoteFingerprints[entry.Fingerprint] = struct{}{}
		session.Synced++
	}
	session.CloudVideos = len(remote) + session.Synced
}

func (s *Service) safeArtifactPath(uri string) (string, error) {
	parsed, err := url.Parse(uri)
	if err != nil || parsed.Scheme != "file" || parsed.Host != "" {
		return "", errors.New("artifact URI must be a local file URI")
	}
	path, err := url.PathUnescape(parsed.Path)
	if err != nil {
		return "", err
	}
	resolved, err := filepath.Abs(filepath.FromSlash(path))
	if err != nil {
		return "", err
	}
	relative, err := filepath.Rel(s.tasksRoot, resolved)
	if err != nil || relative == ".." || strings.HasPrefix(relative, ".."+string(filepath.Separator)) {
		return "", errors.New("artifact path escapes the local task directory")
	}
	return resolved, nil
}

func (s *Service) authenticatedDo(ctx context.Context, method, path string, body, result any) error {
	s.mu.RLock()
	session := s.session
	s.mu.RUnlock()
	if session.Backend == "" || session.Key == "" {
		return errors.New("cloud login is required")
	}
	return s.do(ctx, session, method, path, body, result)
}

func (s *Service) do(ctx context.Context, session storedSession, method, path string, body, result any) error {
	var reader io.Reader
	if body != nil {
		encoded, err := json.Marshal(body)
		if err != nil {
			return err
		}
		reader = bytes.NewReader(encoded)
	}
	request, err := http.NewRequestWithContext(ctx, method, session.Backend+path, reader)
	if err != nil {
		return err
	}
	request.Header.Set("Authorization", "Bearer "+session.Key)
	request.Header.Set("Accept", "application/json")
	if body != nil {
		request.Header.Set("Content-Type", "application/json")
	}
	response, err := s.client.Do(request)
	if err != nil {
		return fmt.Errorf("call cloud backend: %w", err)
	}
	defer response.Body.Close()
	payload, err := io.ReadAll(io.LimitReader(response.Body, maxResponseBytes+1))
	if err != nil {
		return err
	}
	if len(payload) > maxResponseBytes {
		return errors.New("cloud response exceeds size limit")
	}
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		var failure struct {
			Detail string `json:"detail"`
		}
		_ = json.Unmarshal(payload, &failure)
		if failure.Detail == "" {
			failure.Detail = strings.TrimSpace(string(payload))
		}
		return fmt.Errorf("cloud HTTP %d: %s", response.StatusCode, failure.Detail)
	}
	if result != nil {
		if err := json.Unmarshal(payload, result); err != nil {
			return err
		}
	}
	return nil
}

func (s *Service) putAudio(ctx context.Context, uploadURL, contentType, path string, size int64) error {
	parsed, err := url.Parse(uploadURL)
	if err != nil || parsed.Host == "" || parsed.User != nil {
		return errors.New("cloud returned an invalid upload URL")
	}
	loopback := parsed.Hostname() == "127.0.0.1" || parsed.Hostname() == "localhost" || parsed.Hostname() == "::1"
	if parsed.Scheme != "https" && !(parsed.Scheme == "http" && loopback) {
		return errors.New("upload URL must use HTTPS")
	}
	file, err := os.Open(path)
	if err != nil {
		return err
	}
	defer file.Close()
	request, err := http.NewRequestWithContext(ctx, http.MethodPut, uploadURL, file)
	if err != nil {
		return err
	}
	request.ContentLength = size
	if contentType == "" {
		contentType = "audio/mp4"
	}
	request.Header.Set("Content-Type", contentType)
	response, err := s.upload.Do(request)
	if err != nil {
		return fmt.Errorf("upload cloud audio: %w", err)
	}
	defer response.Body.Close()
	_, _ = io.Copy(io.Discard, io.LimitReader(response.Body, 1<<20))
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return fmt.Errorf("upload cloud audio: HTTP %d", response.StatusCode)
	}
	return nil
}

func (s *Service) authenticatedText(ctx context.Context, endpoint string) ([]byte, error) {
	parsed, err := url.Parse(endpoint)
	if err != nil || parsed.IsAbs() || parsed.Host != "" || !strings.HasPrefix(parsed.Path, "/v1/tasks/") {
		return nil, errors.New("cloud returned an invalid artifact URI")
	}
	s.mu.RLock()
	session := s.session
	s.mu.RUnlock()
	if session.Backend == "" || session.Key == "" {
		return nil, errors.New("cloud login is required")
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, session.Backend+parsed.RequestURI(), nil)
	if err != nil {
		return nil, err
	}
	request.Header.Set("Authorization", "Bearer "+session.Key)
	response, err := s.client.Do(request)
	if err != nil {
		return nil, err
	}
	defer response.Body.Close()
	payload, err := io.ReadAll(io.LimitReader(response.Body, maxArtifactBytes+1))
	if err != nil {
		return nil, err
	}
	if len(payload) > maxArtifactBytes {
		return nil, errors.New("cloud artifact exceeds the 32 MB limit")
	}
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return nil, fmt.Errorf("download cloud artifact: HTTP %d", response.StatusCode)
	}
	return payload, nil
}

func extractAudio(ctx context.Context, source, output string) error {
	return extractAudioWithRoot(ctx, "", source, output)
}

func extractAudioWithRoot(ctx context.Context, dataDirectory, source, output string) error {
	ffmpeg, err := managedtools.Find(dataDirectory, "ffmpeg")
	if err != nil {
		return errors.New("ffmpeg is required to prepare cloud audio")
	}
	bounded, cancel := context.WithTimeout(ctx, 3*time.Hour)
	defer cancel()
	command := exec.CommandContext(bounded, ffmpeg, "-v", "error", "-y", "-i", source, "-vn", "-sn", "-dn", "-c:a", "aac", "-b:a", "160k", "-movflags", "+faststart", output)
	configureCloudCommand(command)
	result, err := command.CombinedOutput()
	if err != nil {
		return fmt.Errorf("extract cloud audio: %s", strings.TrimSpace(string(result)))
	}
	return nil
}

func stringOption(options map[string]any, key, fallback string) string {
	if value, ok := options[key].(string); ok && strings.TrimSpace(value) != "" {
		return strings.TrimSpace(value)
	}
	return fallback
}

func numberOption(options map[string]any, key string, fallback int) int {
	switch value := options[key].(type) {
	case int:
		if value >= 4 && value <= 24 {
			return value
		}
	case float64:
		if value >= 4 && value <= 24 {
			return int(value)
		}
	}
	return fallback
}

func validBackend(value string) (string, error) {
	parsed, err := url.Parse(strings.TrimSpace(value))
	if err != nil || parsed.Host == "" || parsed.User != nil || parsed.RawQuery != "" || parsed.Fragment != "" {
		return "", errors.New("cloud backend must be an absolute URL without credentials, query, or fragment")
	}
	host := parsed.Hostname()
	loopback := host == "127.0.0.1" || host == "localhost" || host == "::1"
	if parsed.Scheme != "https" && !(parsed.Scheme == "http" && loopback) {
		return "", errors.New("cloud backend must use HTTPS; HTTP is allowed only for loopback development")
	}
	parsed.Path = strings.TrimRight(parsed.Path, "/")
	return strings.TrimRight(parsed.String(), "/"), nil
}

func (s *Service) load() error {
	data, err := os.ReadFile(s.configPath)
	if err != nil && !errors.Is(err, os.ErrNotExist) {
		return err
	}
	if err == nil {
		var value storedSession
		if err := json.Unmarshal(data, &value); err != nil {
			return err
		}
		backend, backendErr := validBackend(value.Backend)
		if backendErr != nil || strings.TrimSpace(value.Key) == "" {
			return errors.New("stored cloud session is invalid")
		}
		value.Backend = backend
		s.session = value
	}
	data, err = os.ReadFile(s.linksPath)
	if err != nil && !errors.Is(err, os.ErrNotExist) {
		return err
	}
	if err == nil {
		if err := json.Unmarshal(data, &s.links); err != nil {
			return err
		}
		if s.links == nil {
			s.links = map[string]taskLink{}
		}
	}
	return nil
}

func (s *Service) saveLocked() error {
	data, err := json.Marshal(s.session)
	if err != nil {
		return err
	}
	data = append(data, '\n')
	if err := os.MkdirAll(filepath.Dir(s.configPath), 0o700); err != nil {
		return err
	}
	temporary := s.configPath + ".tmp"
	if err := os.WriteFile(temporary, data, 0o600); err != nil {
		return err
	}
	if err := os.Rename(temporary, s.configPath); err != nil {
		_ = os.Remove(temporary)
		return err
	}
	return nil
}

func (s *Service) saveLinksLocked() error {
	data, err := json.Marshal(s.links)
	if err != nil {
		return err
	}
	data = append(data, '\n')
	if err := os.MkdirAll(filepath.Dir(s.linksPath), 0o700); err != nil {
		return err
	}
	temporary := s.linksPath + ".tmp"
	if err := os.WriteFile(temporary, data, 0o600); err != nil {
		return err
	}
	if err := os.Rename(temporary, s.linksPath); err != nil {
		_ = os.Remove(temporary)
		return err
	}
	return nil
}
