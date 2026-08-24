package cloud

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strconv"
	"testing"
	"time"

	"github.com/Ricori/finoka/desktop/internal/library"
)

type fakeProvider struct {
	manifest artifactManifest
}

type fakeMedia struct {
	path string
}

type fakeCatalog struct {
	fakeMedia
	entries []library.Entry
}

func (f fakeCatalog) List() []library.Entry {
	return append([]library.Entry(nil), f.entries...)
}

func (f fakeMedia) ResolveMedia(id string) (string, string, string, float64, error) {
	if id != "loc_0123456789ab" {
		return "", "", "", 0, os.ErrNotExist
	}
	return f.path, "demo.mp4", "fingerprint", 60, nil
}

type projectingProvider struct {
	projected map[string]any
}

func (p *projectingProvider) DoJSON(_ context.Context, method, endpoint string, body any, result any) error {
	if method != http.MethodPost || endpoint != "/v1/documents/project" {
		return os.ErrInvalid
	}
	p.projected = body.(map[string]any)
	encoded, _ := json.Marshal(map[string]any{"schema": 1, "video_id": "loc_0123456789ab"})
	return json.Unmarshal(encoded, result)
}

func (f fakeProvider) DoJSON(_ context.Context, method, endpoint string, _ any, result any) error {
	if method != http.MethodGet || endpoint != "/v1/tasks/0123456789abcdef0123456789abcdef/artifacts" {
		panic("unexpected provider call")
	}
	encoded, _ := json.Marshal(f.manifest)
	return json.Unmarshal(encoded, result)
}

func TestBackendValidation(t *testing.T) {
	for _, value := range []string{"", "http://example.com", "https://user@example.com", "https://example.com?q=1"} {
		if _, err := validBackend(value); err == nil {
			t.Fatalf("expected %q to fail", value)
		}
	}
	if got, err := validBackend("https://example.com/api/"); err != nil || got != "https://example.com/api" {
		t.Fatalf("backend = %q, %v", got, err)
	}
}

func TestLoginLibraryAndArtifactSync(t *testing.T) {
	root := t.TempDir()
	taskID := "0123456789abcdef0123456789abcdef"
	taskRoot := filepath.Join(root, "tasks", taskID, "workspace")
	if err := os.MkdirAll(taskRoot, 0o755); err != nil {
		t.Fatal(err)
	}
	artifactPath := filepath.Join(taskRoot, "final.srt")
	if err := os.WriteFile(artifactPath, []byte("1\n00:00:00,000 --> 00:00:01,000\n字幕\n"), 0o600); err != nil {
		t.Fatal(err)
	}

	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		if request.Header.Get("Authorization") != "Bearer login-key" {
			http.Error(writer, `{"detail":"key 无效"}`, http.StatusUnauthorized)
			return
		}
		writer.Header().Set("Content-Type", "application/json")
		switch request.URL.Path {
		case "/v1/session":
			_, _ = writer.Write([]byte(`{"authenticated":true,"remaining":3,"running":0}`))
		case "/v1/library":
			_, _ = writer.Write([]byte(`{"videos":[]}`))
		case "/v1/tasks":
			_, _ = writer.Write([]byte(`{"schema":1,"tasks":[{"snapshot":{"task_id":"vid_0123456789abcdef01234567","provider":"cloud","state":"completed"},"media_id":"","title":"demo"}]}`))
		case "/v1/library/sync":
			var body syncRequest
			if err := json.NewDecoder(request.Body).Decode(&body); err != nil || body.Artifacts["final_srt"] == "" {
				http.Error(writer, `{"detail":"missing artifact"}`, http.StatusBadRequest)
				return
			}
			_, _ = writer.Write([]byte(`{"id":"vid_1","title":"demo","fingerprint":"fp","duration":1,"status":"completed","source":"local_sync","createdAt":"now","updatedAt":"now"}`))
		default:
			http.NotFound(writer, request)
		}
	}))
	defer server.Close()

	provider := fakeProvider{manifest: artifactManifest{
		EngineCommit: "commit",
		Artifacts: map[string]struct {
			URI string `json:"uri"`
		}{
			"final_srt": {URI: "file://" + filepath.ToSlash(artifactPath)},
		},
	}}
	service, err := New(root, provider)
	if err != nil {
		t.Fatal(err)
	}
	if session, err := service.Login(server.URL, "login-key"); err != nil || !session.Authenticated {
		t.Fatalf("login = %#v, %v", session, err)
	}
	if session, err := service.RefreshSession(); err != nil || session.Remaining == nil || *session.Remaining != 3 {
		t.Fatalf("refresh session = %#v, %v", session, err)
	}
	if library, err := service.Library(); err != nil || len(library) != 0 {
		t.Fatalf("library = %#v, %v", library, err)
	}
	if tasks, err := service.ListTasks(); err != nil || len(tasks["tasks"].([]any)) != 1 {
		t.Fatalf("tasks = %#v, %v", tasks, err)
	}
	entry, err := service.SyncLocalTask(taskID, "loc_1", "fp", "demo", 1)
	if err != nil || entry.ID != "vid_1" {
		t.Fatalf("sync = %#v, %v", entry, err)
	}
	if err := service.Logout(); err != nil || service.Session().Authenticated {
		t.Fatalf("logout = %v, %#v", err, service.Session())
	}
}

func TestAdminKeyManagement(t *testing.T) {
	root := t.TempDir()
	identifier := "custom-secret"
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		if request.Header.Get("Authorization") != "Bearer admin-token" {
			http.Error(writer, `{"detail":"unauthorized"}`, http.StatusUnauthorized)
			return
		}
		writer.Header().Set("Content-Type", "application/json")
		switch {
		case request.Method == http.MethodGet && request.URL.Path == "/v1/session":
			_, _ = writer.Write([]byte(`{"authenticated":true,"admin":true,"name":"管理员","remaining":null,"running":0}`))
		case request.Method == http.MethodGet && request.URL.Path == "/v1/library":
			_, _ = writer.Write([]byte(`{"videos":[]}`))
		case request.Method == http.MethodGet && request.URL.Path == "/v1/admin/keys":
			_, _ = writer.Write([]byte(`{"keys":[{"id":"` + identifier + `","name":"剪辑组","key":"demo-secret","keyPreview":"demo-secret","remaining":3,"submitted":2,"running":1}]}`))
		case request.Method == http.MethodPost && request.URL.Path == "/v1/admin/keys":
			var body map[string]any
			_ = json.NewDecoder(request.Body).Decode(&body)
			if body["name"] != "字幕组" || body["key"] != "custom-secret" || body["remaining"] != float64(5) {
				http.Error(writer, `{"detail":"invalid body"}`, http.StatusBadRequest)
				return
			}
			_, _ = writer.Write([]byte(`{"id":"` + identifier + `","name":"字幕组","keyPreview":"custom-secret","remaining":5,"key":"custom-secret","generated":false}`))
		case request.Method == http.MethodPut && request.URL.Path == "/v1/admin/keys/"+identifier:
			_, _ = writer.Write([]byte(`{"id":"` + identifier + `","name":"终审组","key":"custom-secret","keyPreview":"custom-secret","remaining":8}`))
		case request.Method == http.MethodDelete && request.URL.Path == "/v1/admin/keys/"+identifier:
			_, _ = writer.Write([]byte(`{"removed":"` + identifier + `"}`))
		default:
			http.NotFound(writer, request)
		}
	}))
	defer server.Close()

	service, err := New(root, fakeProvider{})
	if err != nil {
		t.Fatal(err)
	}
	session, err := service.Login(server.URL, "admin-token")
	if err != nil || !session.Admin || session.Name != "管理员" || session.Remaining != nil {
		t.Fatalf("admin login = %#v, %v", session, err)
	}
	keys, err := service.AdminKeys()
	if err != nil || len(keys) != 1 || keys[0].Name != "剪辑组" || keys[0].Key != "demo-secret" || keys[0].Running != 1 {
		t.Fatalf("admin keys = %#v, %v", keys, err)
	}
	issued, err := service.CreateAdminKey("字幕组", "custom-secret", 5)
	if err != nil || issued.ID != "custom-secret" || issued.Key != "custom-secret" || issued.Name != "字幕组" {
		t.Fatalf("issued key = %#v, %v", issued, err)
	}
	updated, err := service.UpdateAdminKey(identifier, "终审组", 8)
	if err != nil || updated.Remaining != 8 {
		t.Fatalf("updated key = %#v, %v", updated, err)
	}
	if err := service.DeleteAdminKey(identifier); err != nil {
		t.Fatalf("delete key: %v", err)
	}
}

func TestDeleteLibraryEntry(t *testing.T) {
	root := t.TempDir()
	identifier := "vid_0123456789abcdef01234567"
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		writer.Header().Set("Content-Type", "application/json")
		switch {
		case request.Method == http.MethodGet && request.URL.Path == "/v1/session":
			_, _ = writer.Write([]byte(`{"authenticated":true,"remaining":3,"running":0}`))
		case request.Method == http.MethodGet && request.URL.Path == "/v1/library":
			_, _ = writer.Write([]byte(`{"videos":[]}`))
		case request.Method == http.MethodDelete && request.URL.Path == "/v1/library/"+identifier:
			_, _ = writer.Write([]byte(`{"removed":"` + identifier + `"}`))
		default:
			http.NotFound(writer, request)
		}
	}))
	defer server.Close()

	service, err := New(root, fakeProvider{})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := service.Login(server.URL, "login-key"); err != nil {
		t.Fatal(err)
	}
	if err := service.DeleteLibraryEntry(identifier); err != nil {
		t.Fatalf("delete library entry: %v", err)
	}
	if err := service.DeleteLibraryEntry("invalid"); err == nil {
		t.Fatal("expected invalid library entry id to fail")
	}
}

func TestLoginMergesExistingLocalDocumentsAndSkipsRemoteFingerprints(t *testing.T) {
	root := t.TempDir()
	taskID := "0123456789abcdef0123456789abcdef"
	localID := "loc_0123456789ab"
	artifactRoot := filepath.Join(root, "tasks", taskID, "workspace")
	if err := os.MkdirAll(artifactRoot, 0o755); err != nil {
		t.Fatal(err)
	}
	artifactPath := filepath.Join(artifactRoot, "final.srt")
	if err := os.WriteFile(artifactPath, []byte("1\n00:00:00,000 --> 00:00:01,000\n字幕\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	manifest := artifactManifest{
		TaskID: taskID, EngineCommit: "commit",
		Artifacts: map[string]struct {
			URI string `json:"uri"`
		}{"final_srt": {URI: "file://" + filepath.ToSlash(artifactPath)}},
	}
	documentRoot := filepath.Join(root, "documents", localID)
	if err := os.MkdirAll(documentRoot, 0o755); err != nil {
		t.Fatal(err)
	}
	encodedManifest, _ := json.Marshal(manifest)
	if err := os.WriteFile(filepath.Join(documentRoot, "artifacts.json"), encodedManifest, 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(documentRoot, "document.json"), []byte(`{"schema":1}`), 0o600); err != nil {
		t.Fatal(err)
	}

	remote := []Entry{}
	syncCalls := 0
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		if request.Header.Get("Authorization") != "Bearer login-key" {
			http.Error(writer, `{"detail":"key 无效"}`, http.StatusUnauthorized)
			return
		}
		writer.Header().Set("Content-Type", "application/json")
		switch request.URL.Path {
		case "/v1/session":
			_, _ = writer.Write([]byte(`{"authenticated":true,"remaining":3,"running":0}`))
		case "/v1/library":
			_ = json.NewEncoder(writer).Encode(map[string]any{"videos": remote})
		case "/v1/library/sync":
			syncCalls++
			var body syncRequest
			if err := json.NewDecoder(request.Body).Decode(&body); err != nil || body.Fingerprint != "fingerprint" || body.Artifacts["final_srt"] == "" {
				http.Error(writer, `{"detail":"invalid sync"}`, http.StatusBadRequest)
				return
			}
			entry := Entry{ID: "vid_1", Title: body.Title, Fingerprint: body.Fingerprint, Duration: body.Duration, Status: "completed", Source: "local_sync", CreatedAt: "now", UpdatedAt: "now"}
			remote = append(remote, entry)
			_ = json.NewEncoder(writer).Encode(entry)
		default:
			http.NotFound(writer, request)
		}
	}))
	defer server.Close()

	catalog := fakeCatalog{
		fakeMedia: fakeMedia{path: artifactPath},
		entries: []library.Entry{{
			ID: localID, Title: "demo.mp4", Fingerprint: "fingerprint", Duration: 60,
			DocumentAvailable: true, Available: true,
		}},
	}
	service, err := New(root, fakeProvider{}, catalog)
	if err != nil {
		t.Fatal(err)
	}
	session, err := service.Login(server.URL, "login-key")
	if err != nil || session.Synced != 1 || session.SyncFailed != 0 || session.CloudVideos != 1 || syncCalls != 1 {
		t.Fatalf("first merge = %#v, calls=%d, err=%v", session, syncCalls, err)
	}
	session, err = service.RefreshSession()
	if err != nil || session.Synced != 0 || session.SyncSkipped != 1 || session.CloudVideos != 1 || syncCalls != 1 {
		t.Fatalf("second merge = %#v, calls=%d, err=%v", session, syncCalls, err)
	}
}

func TestRealModalLoginMergesAnIsolatedLocalLibrary(t *testing.T) {
	keyPath := os.Getenv("FINOKA_MODAL_TEST_KEY_FILE")
	if keyPath == "" {
		t.Skip("set FINOKA_MODAL_TEST_KEY_FILE to run the deployed Modal integration")
	}
	keyResponse, err := os.ReadFile(keyPath)
	if err != nil {
		t.Fatal(err)
	}
	var issued struct {
		Key string `json:"key"`
	}
	if err := json.Unmarshal(keyResponse, &issued); err != nil || issued.Key == "" {
		t.Fatalf("invalid generated key file: %v", err)
	}

	root := t.TempDir()
	taskID := "0123456789abcdef0123456789abcdef"
	localID := "loc_0123456789ab"
	fingerprint := "modal-sync-" + strconv.FormatInt(time.Now().UnixNano(), 10)
	artifactRoot := filepath.Join(root, "tasks", taskID, "workspace")
	if err := os.MkdirAll(artifactRoot, 0o755); err != nil {
		t.Fatal(err)
	}
	artifactPath := filepath.Join(artifactRoot, "final.srt")
	if err := os.WriteFile(artifactPath, []byte("1\n00:00:00,000 --> 00:00:01,000\n真实同步验证\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	manifest := artifactManifest{
		TaskID: taskID, EngineCommit: "modal-integration",
		Artifacts: map[string]struct {
			URI string `json:"uri"`
		}{"final_srt": {URI: "file://" + filepath.ToSlash(artifactPath)}},
	}
	documentRoot := filepath.Join(root, "documents", localID)
	if err := os.MkdirAll(documentRoot, 0o755); err != nil {
		t.Fatal(err)
	}
	encodedManifest, _ := json.Marshal(manifest)
	if err := os.WriteFile(filepath.Join(documentRoot, "artifacts.json"), encodedManifest, 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(documentRoot, "document.json"), []byte(`{"schema":1}`), 0o600); err != nil {
		t.Fatal(err)
	}
	encodedLibrary, _ := json.Marshal([]library.Entry{{
		ID: localID, SourcePath: artifactPath, Title: "Modal 同步验证", Fingerprint: fingerprint,
		Duration: 1, AddedAt: time.Now().UnixMilli(), Available: true,
	}})
	if err := os.WriteFile(filepath.Join(root, "library.json"), encodedLibrary, 0o600); err != nil {
		t.Fatal(err)
	}
	catalog, err := library.New(root)
	if err != nil {
		t.Fatal(err)
	}
	service, err := New(root, fakeProvider{}, catalog)
	if err != nil {
		t.Fatal(err)
	}
	endpoint := os.Getenv("FINOKA_MODAL_ENDPOINT")
	if endpoint == "" {
		endpoint = "https://ricori--finoka-cloud-api.modal.run"
	}
	session, err := service.Login(endpoint, issued.Key)
	if err != nil || session.Synced != 1 || session.SyncFailed != 0 {
		t.Fatalf("real login merge = %#v, %v", session, err)
	}
	remote, err := service.Library()
	if err != nil || len(remote) != 1 || remote[0].Fingerprint != fingerprint {
		t.Fatalf("real merged library = %#v, %v", remote, err)
	}
	refreshed, err := service.RefreshSession()
	if err != nil || refreshed.SyncSkipped != 1 || refreshed.Synced != 0 {
		t.Fatalf("real idempotent refresh = %#v, %v", refreshed, err)
	}
}

func TestArtifactPathCannotEscapeTaskRoot(t *testing.T) {
	service, err := New(t.TempDir(), fakeProvider{})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := service.safeArtifactPath("file:///etc/passwd"); err == nil {
		t.Fatal("expected escaped artifact to fail")
	}
}

func TestCloudTaskUploadsAudioPollsCancelsAndProjectsArtifacts(t *testing.T) {
	root := t.TempDir()
	source := filepath.Join(root, "video.mp4")
	if err := os.WriteFile(source, []byte("video"), 0o600); err != nil {
		t.Fatal(err)
	}
	const taskID = "vid_0123456789abcdef01234567"
	const uploadID = "upl_0123456789abcdef0123456789abcdef"
	uploaded := false
	var server *httptest.Server
	server = httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		writer.Header().Set("Content-Type", "application/json")
		if request.Method == http.MethodPut && request.URL.Path == "/upload" {
			payload, _ := io.ReadAll(request.Body)
			uploaded = string(payload) == "audio-fixture"
			writer.WriteHeader(http.StatusNoContent)
			return
		}
		if request.Header.Get("Authorization") != "Bearer login-key" {
			http.Error(writer, `{"detail":"unauthorized"}`, http.StatusUnauthorized)
			return
		}
		switch {
		case request.URL.Path == "/v1/session":
			_, _ = writer.Write([]byte(`{"authenticated":true,"remaining":2,"running":0}`))
		case request.URL.Path == "/v1/capabilities":
			_, _ = writer.Write([]byte(`{"provider":"cloud","adapter_schema":1,"artifact_schema":1}`))
		case request.URL.Path == "/v1/uploads/init":
			_, _ = writer.Write([]byte(`{"objectId":"` + uploadID + `","uploadUrl":"` + server.URL + `/upload","contentType":"audio/mp4"}`))
		case request.Method == http.MethodPost && request.URL.Path == "/v1/tasks":
			var body map[string]any
			_ = json.NewDecoder(request.Body).Decode(&body)
			source := body["source"].(map[string]any)
			correction := body["correction"].(map[string]any)
			if source["kind"] != "uploaded_audio" || source["object_id"] != uploadID {
				http.Error(writer, `{"detail":"invalid source"}`, http.StatusBadRequest)
				return
			}
			if correction["media"] != "text" || correction["retrieval"] != "none" {
				http.Error(writer, `{"detail":"cloud correction must be text-only without retrieval"}`, http.StatusBadRequest)
				return
			}
			_, _ = writer.Write([]byte(`{"schema":1,"task_id":"` + taskID + `","provider":"cloud","state":"queued"}`))
		case request.Method == http.MethodGet && request.URL.Path == "/v1/tasks/"+taskID:
			_, _ = writer.Write([]byte(`{"schema":1,"task_id":"` + taskID + `","provider":"cloud","state":"completed"}`))
		case request.Method == http.MethodGet && request.URL.Path == "/v1/tasks/"+taskID+"/events":
			_, _ = writer.Write([]byte(`{"schema":1,"task_id":"` + taskID + `","events":[],"next_cursor":0,"state":"completed"}`))
		case request.Method == http.MethodPost && request.URL.Path == "/v1/tasks/"+taskID+"/cancel":
			_, _ = writer.Write([]byte(`{"schema":1,"task_id":"` + taskID + `","provider":"cloud","state":"cancelled"}`))
		case request.Method == http.MethodGet && request.URL.Path == "/v1/tasks/"+taskID+"/artifacts":
			_, _ = writer.Write([]byte(`{"schema":1,"task_id":"` + taskID + `","engine_commit":"commit","artifacts":{"stable_json":{"uri":"/v1/tasks/` + taskID + `/artifacts/stable_json","sha256":"97bfe45dfecd80477bc6cafdd457b5f23045d8715fbdc98f6da175f6f2ec6b4f","bytes":58}}}`))
		case request.Method == http.MethodGet && request.URL.Path == "/v1/tasks/"+taskID+"/artifacts/stable_json":
			writer.Header().Set("Content-Type", "application/json")
			_, _ = writer.Write([]byte(`{"segments":[{"id":1,"start":0,"end":1,"text":"fixture"}]}`))
		default:
			http.NotFound(writer, request)
		}
	}))
	defer server.Close()

	projector := &projectingProvider{}
	service, err := New(root, projector, fakeMedia{path: source})
	if err != nil {
		t.Fatal(err)
	}
	service.extractor = func(_ context.Context, _, output string) error {
		return os.WriteFile(output, []byte("audio-fixture"), 0o600)
	}
	if _, err := service.Login(server.URL, "login-key"); err != nil {
		t.Fatal(err)
	}
	if capabilities, err := service.Capabilities(); err != nil || capabilities["provider"] != "cloud" {
		t.Fatalf("capabilities = %#v, %v", capabilities, err)
	}
	snapshot, err := service.StartTask("loc_0123456789ab", map[string]any{"target": "raw-srt"})
	if err != nil || snapshot["task_id"] != taskID || !uploaded {
		t.Fatalf("start = %#v, uploaded=%v, err=%v", snapshot, uploaded, err)
	}
	if status, err := service.TaskStatus(taskID); err != nil || status["state"] != "completed" {
		t.Fatalf("status = %#v, %v", status, err)
	}
	if _, err := service.TaskEvents(taskID, 0); err != nil {
		t.Fatal(err)
	}
	if cancelled, err := service.CancelTask(taskID); err != nil || cancelled["state"] != "cancelled" {
		t.Fatalf("cancel = %#v, %v", cancelled, err)
	}
	manifest, err := service.TaskArtifacts(taskID)
	if err != nil || manifest["engine_commit"] != "commit" {
		t.Fatalf("artifacts = %#v, %v", manifest, err)
	}
	if projector.projected == nil || projector.projected["video_id"] != "loc_0123456789ab" {
		t.Fatalf("projection = %#v", projector.projected)
	}
}
