import { collection, doc, serverTimestamp, setDoc, writeBatch } from "firebase/firestore";
import { ref, uploadBytes } from "firebase/storage";
import type { ChannelId } from "./adapters/types";
import { getFirebaseServices, hasFirebaseConfig, type FirebaseDashboardUser } from "./firebaseClient";
import type { NaverMonthlyReport } from "./naverMonthlyParser";

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
  naverMonthlyReport?: NaverMonthlyReport | null;
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

    const naverReport = payload.naverMonthlyReport ?? null;

    await setDoc(importRef, {
      orgId: ORG_ID,
      status: "uploaded",
      parseStatus: naverReport ? (naverReport.parseWarnings.length ? "partial" : "complete") : "pending",
      source: "data-center",
      importedAtLabel: payload.importedAt,
      totalFiles: payload.totalFiles,
      channelCounts: payload.channelCounts,
      detectedRecords: payload.items,
      parsedItems: [],
      naverMonthlyReport: naverReport,
      files: uploadedFiles,
      createdBy: user.uid,
      createdByEmail: user.email,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });

    if (naverReport) {
      const batch = writeBatch(db);
      const snapshotId = `naver-blog-${naverReport.periodKey}`;

      batch.set(doc(db, "orgs", ORG_ID, "metricSnapshots", snapshotId), {
        orgId: ORG_ID,
        platform: "naver",
        channel: "naver",
        periodKey: naverReport.periodKey,
        periodLabel: naverReport.periodLabel,
        sourceImportId: importRef.id,
        metrics: naverReport.metricSnapshot,
        validationRows: naverReport.validationRows,
        sourceFiles: naverReport.sourceFiles,
        importedAtLabel: naverReport.importedAt,
        updatedAt: serverTimestamp(),
      });

      Object.entries(naverReport.metricTimeSeries).forEach(([metricKey, points]) => {
        batch.set(doc(db, "orgs", ORG_ID, "metricTimeSeries", `${snapshotId}-${metricKey}`), {
          orgId: ORG_ID,
          platform: "naver",
          channel: "naver",
          periodKey: naverReport.periodKey,
          metricKey,
          points,
          sourceImportId: importRef.id,
          updatedAt: serverTimestamp(),
        });
      });

      batch.set(doc(db, "orgs", ORG_ID, "contentRankings", snapshotId), {
        orgId: ORG_ID,
        platform: "naver",
        channel: "naver",
        periodKey: naverReport.periodKey,
        periodLabel: naverReport.periodLabel,
        rows: naverReport.rankingRows,
        sourceImportId: importRef.id,
        sourceFiles: naverReport.sourceFiles,
        updatedAt: serverTimestamp(),
      });

      await batch.commit();
    }

    return {
      status: "saved",
      importId: importRef.id,
      message: naverReport
        ? `Firebase 저장 완료 · 네이버 ${naverReport.periodLabel} 파싱 · importId ${importRef.id}`
        : `Firebase Storage 저장 완료 · importId ${importRef.id}`,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "알 수 없는 Firebase 저장 오류";
    return { status: "error", message };
  }
}
