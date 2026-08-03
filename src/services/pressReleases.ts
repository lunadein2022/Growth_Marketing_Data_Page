import { getSupabaseClient, hasSupabaseConfig } from "./supabaseClient";

const ORG_ID = "00000000-0000-0000-0000-000000000001";
const BUCKET = "press-images";
const COLUMNS =
  "id,title,body,images,covered_moneytoday,covered_etnews,covered_diginet,created_by,created_at";

export type PressCoverage = { moneytoday: boolean; etnews: boolean; diginet: boolean };

export type PressRelease = {
  id: string;
  title: string;
  body: string;
  images: string[]; // storage object paths
  coverage: PressCoverage;
  createdBy: string | null;
  createdAt: string;
};

type PressRow = {
  id: string;
  title: string;
  body: string;
  images: string[] | null;
  covered_moneytoday: boolean;
  covered_etnews: boolean;
  covered_diginet: boolean;
  created_by: string | null;
  created_at: string;
};

export function canUsePressBoard() {
  return hasSupabaseConfig();
}

function toRelease(row: PressRow): PressRelease {
  return {
    id: row.id,
    title: row.title,
    body: row.body,
    images: row.images ?? [],
    coverage: {
      moneytoday: row.covered_moneytoday,
      etnews: row.covered_etnews,
      diginet: row.covered_diginet,
    },
    createdBy: row.created_by,
    createdAt: row.created_at,
  };
}

function safeName(name: string) {
  const dot = name.lastIndexOf(".");
  const ext = (dot > 0 ? name.slice(dot + 1) : "").replace(/[^A-Za-z0-9]/g, "").toLowerCase();
  const base =
    (dot > 0 ? name.slice(0, dot) : name)
      .replace(/[^A-Za-z0-9._-]/g, "_")
      .replace(/_+/g, "_")
      .replace(/^[_.-]+|[_.-]+$/g, "") || "img";
  return ext ? `${base}.${ext}` : base;
}

export function pressImageUrl(path: string): string {
  const supabase = getSupabaseClient();
  return supabase.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
}

export async function listPressReleases(): Promise<PressRelease[]> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from("press_releases")
    .select(COLUMNS)
    .eq("org_id", ORG_ID)
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return ((data ?? []) as PressRow[]).map(toRelease);
}

export async function getPressRelease(id: string): Promise<PressRelease | null> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from("press_releases")
    .select(COLUMNS)
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data ? toRelease(data as PressRow) : null;
}

export async function createPressRelease(input: {
  title: string;
  body: string;
  files: File[];
  createdBy: string | null;
}): Promise<PressRelease> {
  const supabase = getSupabaseClient();
  const id = crypto.randomUUID();

  const paths: string[] = [];
  for (const [index, file] of input.files.entries()) {
    const path = `${ORG_ID}/${id}/${index + 1}-${safeName(file.name)}`;
    const { error } = await supabase.storage.from(BUCKET).upload(path, file, {
      contentType: file.type || "image/jpeg",
      upsert: false,
    });
    if (error) throw new Error(error.message);
    paths.push(path);
  }

  const { data, error } = await supabase
    .from("press_releases")
    .insert({
      id,
      org_id: ORG_ID,
      title: input.title,
      body: input.body,
      images: paths,
      created_by: input.createdBy,
    })
    .select(COLUMNS)
    .single();
  if (error) throw new Error(error.message);
  return toRelease(data as PressRow);
}

export async function uploadPressImages(id: string, files: File[]): Promise<string[]> {
  const supabase = getSupabaseClient();
  const paths: string[] = [];
  for (const [index, file] of files.entries()) {
    const path = `${ORG_ID}/${id}/${Date.now()}-${index + 1}-${safeName(file.name)}`;
    const { error } = await supabase.storage.from(BUCKET).upload(path, file, {
      contentType: file.type || "image/jpeg",
      upsert: false,
    });
    if (error) throw new Error(error.message);
    paths.push(path);
  }
  return paths;
}

export async function updatePressRelease(input: {
  id: string;
  title: string;
  body: string;
  images: string[];
  removedImages?: string[];
}): Promise<PressRelease> {
  const supabase = getSupabaseClient();

  if (input.removedImages?.length) {
    // Best-effort cleanup of images the user removed.
    await supabase.storage.from(BUCKET).remove(input.removedImages).catch(() => undefined);
  }

  const { data, error } = await supabase
    .from("press_releases")
    .update({
      title: input.title,
      body: input.body,
      images: input.images,
      updated_at: new Date().toISOString(),
    })
    .eq("id", input.id)
    .select(COLUMNS)
    .single();
  if (error) throw new Error(error.message);
  return toRelease(data as PressRow);
}

export async function updatePressCoverage(id: string, coverage: PressCoverage): Promise<void> {
  const supabase = getSupabaseClient();
  const { error } = await supabase
    .from("press_releases")
    .update({
      covered_moneytoday: coverage.moneytoday,
      covered_etnews: coverage.etnews,
      covered_diginet: coverage.diginet,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id);
  if (error) throw new Error(error.message);
}

export async function deletePressRelease(release: PressRelease): Promise<void> {
  const supabase = getSupabaseClient();
  if (release.images.length) {
    // Best-effort image cleanup; ignore storage errors so the row still deletes.
    await supabase.storage.from(BUCKET).remove(release.images).catch(() => undefined);
  }
  const { error } = await supabase.from("press_releases").delete().eq("id", release.id);
  if (error) throw new Error(error.message);
}
