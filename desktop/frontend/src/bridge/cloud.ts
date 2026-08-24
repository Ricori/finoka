import { Service as CloudService } from "../../bindings/github.com/Ricori/finoka/desktop/internal/cloud/index.js";
import type { AdminKey as CloudAdminKey, Entry as CloudEntry, IssuedAdminKey, Session as CloudSession } from "../../bindings/github.com/Ricori/finoka/desktop/internal/cloud/models.js";

export type { CloudAdminKey, CloudEntry, CloudSession, IssuedAdminKey };

export const DEFAULT_CLOUD_BACKEND = "https://ricori--finoka-cloud-api.modal.run";

export const cloudAccount = {
  session: CloudService.Session,
  refreshSession: CloudService.RefreshSession,
  login: CloudService.Login,
  logout: CloudService.Logout,
  async library(): Promise<CloudEntry[]> {
    return (await CloudService.Library()) ?? [];
  },
  deleteLibraryEntry: CloudService.DeleteLibraryEntry,
  syncLocalTask: CloudService.SyncLocalTask,
  capabilities: CloudService.Capabilities,
  listTasks: CloudService.ListTasks,
  startTask: CloudService.StartTask,
  taskStatus: CloudService.TaskStatus,
  taskEvents: CloudService.TaskEvents,
  cancelTask: CloudService.CancelTask,
  retryTask: CloudService.RetryTask,
  resumeTask: CloudService.ResumeTask,
  taskArtifacts: CloudService.TaskArtifacts,
  async adminKeys(): Promise<CloudAdminKey[]> {
    return (await CloudService.AdminKeys()) ?? [];
  },
  createAdminKey: CloudService.CreateAdminKey,
  updateAdminKey: CloudService.UpdateAdminKey,
  deleteAdminKey: CloudService.DeleteAdminKey,
};
