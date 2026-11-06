"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertCircle, CheckCircle2, Loader2, Upload } from "lucide-react";

import { publishApk, startApkUpload } from "./actions";
import { Field, Input } from "@/components/form";
import { buttonClass, cx } from "@/components/ui";

/**
 * Pick the new APK, type its version, press Upload. The file goes from this
 * browser straight to Supabase Storage (see startApkUpload for why it does not
 * pass through our server), and publishApk then points every download button
 * at it.
 */
export function ApkUpload({ currentVersion }: { currentVersion: string }) {
  const router = useRouter();
  const fileInput = useRef<HTMLInputElement>(null);
  const [version, setVersion] = useState("");
  const [progress, setProgress] = useState<number | null>(null);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);

  const busy = progress !== null;

  async function upload() {
    setNote(null);
    const file = fileInput.current?.files?.[0];
    if (!file) return setNote({ ok: false, text: "Choose the .apk file first." });
    if (!/\.apk$/i.test(file.name)) {
      return setNote({ ok: false, text: "That is not an .apk file." });
    }

    setProgress(0);
    try {
      const started = await startApkUpload();
      if (!started.ok) return setNote({ ok: false, text: started.error });

      await new Promise<void>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open("PUT", started.signedUrl);
        xhr.setRequestHeader("content-type", "application/vnd.android.package-archive");
        xhr.setRequestHeader("cache-control", "max-age=300");
        xhr.setRequestHeader("x-upsert", "false");
        xhr.upload.onprogress = (event) => {
          if (event.lengthComputable) setProgress(Math.round((event.loaded / event.total) * 100));
        };
        xhr.onload = () =>
          xhr.status >= 200 && xhr.status < 300
            ? resolve()
            : reject(new Error(`Storage answered ${xhr.status}: ${xhr.responseText.slice(0, 200)}`));
        xhr.onerror = () => reject(new Error("The upload was interrupted. Check the connection and try again."));
        xhr.send(file);
      });

      const result = await publishApk({ path: started.path, version });
      setNote(result.ok ? { ok: true, text: result.message ?? "Published." } : { ok: false, text: result.error });
      if (result.ok) {
        if (fileInput.current) fileInput.current.value = "";
        setVersion("");
        router.refresh();
      }
    } catch (error) {
      setNote({ ok: false, text: error instanceof Error ? error.message : "The upload failed." });
    } finally {
      setProgress(null);
    }
  }

  return (
    <div className="space-y-4">
      <Field label="New APK file" name="apk_file" hint="The .apk you want customers to install.">
        <input
          ref={fileInput}
          name="apk_file"
          type="file"
          accept=".apk,application/vnd.android.package-archive"
          disabled={busy}
          className="block w-full text-sm text-muted file:mr-3 file:rounded-lg file:border-0 file:bg-brand-500/12 file:px-3 file:py-2 file:text-sm file:font-medium file:text-brand-500"
        />
      </Field>

      <Field
        label="Version"
        name="apk_version"
        hint={`Shown beside the download button.${currentVersion ? ` Current: v${currentVersion}.` : ""}`}
      >
        <Input
          name="apk_version"
          value={version}
          onChange={(event) => setVersion(event.target.value)}
          disabled={busy}
          placeholder="1.0.15"
          maxLength={30}
          autoComplete="off"
          className="max-w-48"
        />
      </Field>

      <button
        type="button"
        onClick={upload}
        disabled={busy}
        className={cx(buttonClass("primary"), "w-full sm:w-auto")}
      >
        {busy ? <Loader2 size={15} className="animate-spin" /> : <Upload size={15} />}
        {busy ? `Uploading… ${progress}%` : "Upload and publish"}
      </button>

      {note ? (
        <p
          className={cx(
            "flex items-start gap-2 rounded-lg border px-3 py-2 text-sm",
            note.ok
              ? "border-good-500/40 bg-good-500/10 text-good-500"
              : "border-bad-500/40 bg-bad-500/10 text-bad-500",
          )}
        >
          {note.ok ? (
            <CheckCircle2 size={15} className="mt-0.5 shrink-0" />
          ) : (
            <AlertCircle size={15} className="mt-0.5 shrink-0" />
          )}
          <span>{note.text}</span>
        </p>
      ) : null}
    </div>
  );
}
