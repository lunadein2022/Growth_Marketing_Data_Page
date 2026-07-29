import { collection, doc, serverTimestamp, setDoc } from "firebase/firestore";
import { ref, uploadBytes } from "firebase/storage";
import type { ChannelId } from "./adapters/types";
import { getFirebaseServices, hasFirebaseConfig, type FirebaseDashboardUser } from "./firebaseClient";

export type FirebaseFileImportItem = {
  id: string;
  sourceFileName: string;
  channel: Exclude<ChannelId, "all">;
  title: string;
  type: string;
  metricLabel: string;
  metricValue: string;
};

export type FirebaseFileImportPayload = {
  importedAt: string;
  totalFiles: number;
  channelCounts: Partial<Record<Exclude<ChannelId, "all">, number>>;
  items: FirebaseFileImportItem[];
};

export type FirebaseImportPersistence =
  | { status: "saved"; importId: string; message: string }
  | { status: "skipped"; message: string }
  | { status: "error"; message: string };

const ORG_ID = "dummdumm";

function safeFileName(fileName: string) {
  return fileName.replace(/[\\/#?%*:|"<>]/g, "_").replace(/\s+/g, " ").trim() || "uploaded-file";
}

function fileExtension(fileName: string) {
  const match = fileName.toLowerCase().match(/\.[^.]+$/);
  return match?.[0] ?? "";
}

export async function persistImportedFilesToFirebase(
  files: File[],
  payload: FirebaseFileImportPayload,
  user: FirebaseDashboardUser | null,
): Promise<FirebaseImportPersistence> {
  if (!hasFirebaseConfig()) {
    return { status: "skipped", message: "Firebase 환경변수가 없어 로컬 목업에만 반영했습니다." };
  }

  if (!user) {
    return { status: "skipped", message: "Google 로그인 후 Firebase Storage에 저장할 수 있습니다." };
  }

  try {
    const { db, storage } = getFirebaseServices();
    const importRef = doc(collection(db, "orgs", ORG_ID, "fileImports"));
    const storagePrefix = `orgs/${ORG_ID}/fileImports/${importRef.id}`;

    const uploadedFiles = await Promise.all(
      files.map(async (file, index) => {
        const path = `${storagePrefix}/${index + 1}-${safeFileName(file.name)}`;
        await uploadBytes(ref(storage, path), file, {
          contentType: file.type || "application/octet-stream",
          customMetadata: {
            importId: importRef.id,
            uploadedBy: user.uid,
            source: "data-center",
          },
        });

        return {
          originalName: file.name,
          storagePath: path,
          size: file.size,
          contentType: file.type || null,
          extension: fileExtension(file.name),
        };
      }),
    );

    await setDoc(importRef, {
      orgId: ORG_ID,
      status: "uploaded",
      parseStatus: "pending",
      source: "data-center",
      importedAtLabel: payload.importedAt,
      totalFiles: payload.totalFiles,
      channelCounts: payload.channelCounts,
      parsedItems: payload.items,
      files: uploadedFiles,
      createdBy: user.uid,
      createdByEmail: user.email,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });

    return {
      status: "saved",
      importId: importRef.id,
      message: `Firebase Storage 저장 완료 · importId ${importRef.id}`,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "알 수 없는 Firebase 저장 오류";
    return { status: "error", message };
  }
}
