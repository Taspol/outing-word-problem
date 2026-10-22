"use client";

import { useEffect, useRef, useState, type ComponentProps } from "react";
import { puzzlesFromCsv } from "@/lib/csv";
import { checkProblem, tidy } from "@/lib/text";
import type { Problem, ProblemInput } from "@/lib/types";
import HintText from "./HintText";

async function api(url: string, method: string, body?: unknown): Promise<Problem[]> {
  const res = await fetch(url, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({ error: "The server didn't answer. Try again." }));
  if (!res.ok) throw new Error(data.error ?? "Couldn't save. Try again.");
  return data;
}

const EMPTY: ProblemInput = { hint: "", clue: "", answer: "" };
const FIELDS = ["hint", "clue", "answer"] as const;
const LABELS = { hint: "Pattern", clue: "Clue", answer: "Answer" };
const PLACEHOLDERS = { hint: "e.g. ย _ _ ย _ _", clue: "e.g. ดึงแล้วยาว ปล่อยแล้วหด", answer: "e.g. ยางยืด" };

function badPattern(hint: string) {
  return hint !== "" && !hint.includes("_");
}

export default function ProblemTable({
  problems,
  onChange,
}: {
  problems: Problem[];
  onChange: (p: Problem[]) => void;
}) {
  const [toast, setToast] = useState("");
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const flash = (t: string) => {
    setToast(t);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setToast(""), 2500);
  };
  const missing = problems.filter((p) => !p.answer).length;

  // Upload: the file is read and checked here, then shown for confirmation before anything is replaced.
  const fileRef = useRef<HTMLInputElement>(null);
  const [upload, setUpload] = useState<{ name: string; problems: ProblemInput[]; errors: string[] } | null>(null);
  const [replacing, setReplacing] = useState(false);
  const [uploadError, setUploadError] = useState("");

  const pickFile = async (file: File | undefined) => {
    if (fileRef.current) fileRef.current.value = ""; // so picking the same file again still triggers a change
    if (!file) return;
    setUploadError("");
    const bytes = await file.arrayBuffer();
    // Excel saves Thai CSV as UTF-8 or, in older versions, Windows-874 (TIS-620).
    let text: string;
    try { text = new TextDecoder("utf-8", { fatal: true }).decode(bytes); }
    catch { text = new TextDecoder("windows-874").decode(bytes); }
    setUpload({ name: file.name, ...puzzlesFromCsv(text) });
  };

  const replaceAll = async () => {
    if (!upload) return;
    setReplacing(true);
    setUploadError("");
    try {
      onChange(await api("/api/problems", "PUT", { problems: upload.problems }));
      flash(`Replaced the list with ${upload.problems.length} puzzles from ${upload.name}`);
      setUpload(null);
    } catch (e) {
      setUploadError((e as Error).message);
    }
    setReplacing(false);
  };

  return (
    <section className="flex w-full flex-col items-center gap-[22px]">
      <div className="flex w-full flex-wrap items-center justify-between gap-3">
        <p className="m-0 max-w-[60ch] text-[.95rem] text-on-felt-soft">
          Type the pattern with <code className="font-mono text-on-felt">_</code> for each hidden letter, a clue, and
          the answer. Changes save to the CSV when you leave a row.
          {missing > 0 && (
            <span className="text-gold">
              {" "}
              {missing} puzzle{missing > 1 ? "s have" : " has"} no answer yet.
            </span>
          )}
        </p>
        <div className="flex flex-wrap gap-2.5">
          <input
            ref={fileRef}
            type="file"
            accept=".csv,text/csv"
            hidden
            onChange={(e) => pickFile(e.target.files?.[0])}
          />
          <button
            onClick={() => fileRef.current?.click()}
            className="rounded-full border-2 border-line px-[22px] py-3 font-semibold text-on-felt transition hover:bg-white/10"
          >
            Upload CSV
          </button>
          {/* A file download, not a page navigation, so a plain <a> is right here. */}
          <a
            href="/api/problems?format=csv"
            download
            className="rounded-full border-2 border-line px-[22px] py-3 font-semibold text-on-felt transition hover:bg-white/10"
          >
            Download CSV
          </a>
        </div>
      </div>

      {upload && (
        <UploadReview
          upload={upload}
          current={problems.length}
          busy={replacing}
          error={uploadError}
          onReplace={replaceAll}
          onCancel={() => { setUpload(null); setUploadError(""); }}
        />
      )}

      <div className="w-full overflow-x-auto rounded-[14px] bg-card text-ink shadow-[0_14px_34px_rgba(0,0,0,.3)]">
        <table className="w-full min-w-[720px] border-collapse">
          <thead>
            <tr className="text-left text-[.72rem] tracking-[.08em] text-muted uppercase">
              <th className="border-b-2 border-ink px-2.5 py-3 font-semibold">No.</th>
              {FIELDS.map((f) => (
                <th key={f} className="border-b-2 border-ink px-2.5 py-3 font-semibold">
                  {LABELS[f]}
                </th>
              ))}
              <th className="border-b-2 border-ink px-2.5 py-3" />
            </tr>
          </thead>
          <tbody>
            {!problems.length && (
              <tr>
                <td colSpan={5} className="p-7 text-center text-muted">
                  No puzzles yet. Add the first one in the row below.
                </td>
              </tr>
            )}
            {problems.map((p) => (
              <Row key={`${p.no}:${p.hint}:${p.clue}:${p.answer}`} problem={p} onChange={onChange} flash={flash} />
            ))}
            <NewRow nextNo={problems.length + 1} onChange={onChange} flash={flash} />
          </tbody>
        </table>
      </div>
      <div className="min-h-[1.2em] text-sm text-on-felt-soft" aria-live="polite">
        {toast}
      </div>
    </section>
  );
}

function UploadReview({
  upload,
  current,
  busy,
  error,
  onReplace,
  onCancel,
}: {
  upload: { name: string; problems: ProblemInput[]; errors: string[] };
  current: number;
  busy: boolean;
  error: string;
  onReplace: () => void;
  onCancel: () => void;
}) {
  const { name, problems, errors } = upload;
  const btn = "rounded-full border-2 px-[18px] py-2 font-semibold transition disabled:opacity-40";
  return (
    <div role="alertdialog" aria-labelledby="upload-title" className="w-full rounded-[14px] bg-card p-5 text-ink shadow-[0_14px_34px_rgba(0,0,0,.3)]">
      <p className="text-xs font-semibold tracking-[.08em] text-red uppercase">Upload · {name}</p>
      <h2 id="upload-title" className="mt-1 text-xl font-extrabold tracking-tight">
        {problems.length
          ? `Replace all ${current} puzzles with ${problems.length} from this file?`
          : "This file can't be used"}
      </h2>

      {errors.length > 0 && (
        <div className="mt-3 rounded-lg bg-[#fdeceb] p-3 text-sm text-red">
          <p className="font-semibold">
            {errors.length} row{errors.length > 1 ? "s" : ""} can&apos;t be used
            {problems.length ? " and will be left out:" : ":"}
          </p>
          <ul className="mt-1 list-disc pl-5">
            {errors.slice(0, 6).map((e) => <li key={e}>{e}</li>)}
            {errors.length > 6 && <li>…and {errors.length - 6} more</li>}
          </ul>
        </div>
      )}

      {problems.length > 0 && (
        <>
          <ol className="mt-3 divide-y divide-ink/10 rounded-lg border border-ink/10">
            {problems.slice(0, 3).map((p, i) => (
              <li key={i} className="flex flex-wrap items-baseline gap-x-4 gap-y-1 px-3 py-2">
                <span className="font-mono text-sm text-red">{i + 1}</span>
                <HintText hint={p.hint} className="font-puzzle text-lg font-extrabold" />
                <span className="min-w-0 flex-1 font-puzzle text-ink/80">{p.clue}</span>
                <span className="font-puzzle font-semibold text-red">{p.answer || "—"}</span>
              </li>
            ))}
            {problems.length > 3 && <li className="px-3 py-2 text-sm text-muted">…and {problems.length - 3} more</li>}
          </ol>
          <p className="mt-3 text-sm text-muted">
            The current list will be gone. Download a CSV first if you want to keep a copy.
          </p>
        </>
      )}

      {error && <p className="mt-2 text-sm text-red">{error}</p>}
      <div className="mt-4 flex flex-wrap gap-2.5">
        {problems.length > 0 && (
          <button onClick={onReplace} disabled={busy} className={`${btn} border-red bg-red text-white hover:bg-red-deep`}>
            {busy ? "Replacing…" : `Replace with ${problems.length} puzzles`}
          </button>
        )}
        <button onClick={onCancel} disabled={busy} className={`${btn} border-ink/20 text-ink hover:bg-ink/5`}>
          {problems.length ? "Cancel" : "Close"}
        </button>
      </div>
    </div>
  );
}

const inputBase =
  "w-full rounded-md border px-2 py-1.5 font-puzzle text-[1.05rem] font-medium text-ink outline-none focus:border-ink focus:bg-white";
const widths = { hint: "w-[11em] min-w-[9em]", clue: "min-w-[16em]", answer: "w-[10em] min-w-[8em]" };

/**
 * The pattern box: while it isn't focused, the pattern is drawn as on the card (marks over their blanks) on top
 * of the box, and the raw text underneath is hidden. Focusing it shows the raw text for editing.
 */
function PatternInput({ className = "", ...props }: ComponentProps<"input">) {
  return (
    <div className="relative">
      <input {...props} className={`peer ${className} placeholder:text-muted [&:not(:focus)]:text-transparent`} />
      <HintText
        hint={String(props.value ?? "")}
        className="pointer-events-none absolute top-1/2 left-[calc(.5rem+1px)] max-w-[calc(100%-1rem)] -translate-y-1/2 overflow-hidden font-puzzle text-[1.15rem] font-extrabold text-ink peer-focus:hidden"
      />
    </div>
  );
}

function Field({ isPattern, ...props }: ComponentProps<"input"> & { isPattern: boolean }) {
  return isPattern ? <PatternInput {...props} /> : <input {...props} />;
}

function Row({
  problem,
  onChange,
  flash,
}: {
  problem: Problem;
  onChange: (p: Problem[]) => void;
  flash: (t: string) => void;
}) {
  const [value, setValue] = useState<ProblemInput>({ hint: problem.hint, clue: problem.clue, answer: problem.answer });
  const [error, setError] = useState("");
  const [confirm, setConfirm] = useState(false);

  useEffect(() => {
    if (!confirm) return;
    const id = setTimeout(() => setConfirm(false), 3000);
    return () => clearTimeout(id);
  }, [confirm]);

  const commit = async () => {
    const next = { hint: tidy(value.hint), clue: tidy(value.clue), answer: tidy(value.answer) };
    if (FIELDS.every((f) => next[f] === problem[f])) { setValue(next); return; }
    try { checkProblem(next); } catch (e) { setError((e as Error).message); return; }
    try {
      onChange(await api(`/api/problems/${problem.no}`, "PUT", next));
      flash(`Saved puzzle ${problem.no}`);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const remove = async () => {
    if (!confirm) { setConfirm(true); return; }
    try {
      onChange(await api(`/api/problems/${problem.no}`, "DELETE"));
      flash(`Deleted ${problem.hint}`);
    } catch (e) {
      flash((e as Error).message);
    }
  };

  return (
    // Save when focus leaves the row, so tabbing between its fields doesn't save (and re-render) half an edit.
    <tr
      className="align-top"
      onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) commit(); }}
    >
      <td className="w-[3em] border-b border-ink/10 px-2.5 py-2.5 font-mono text-red">{problem.no}</td>
      {FIELDS.map((f) => {
        const bad = (f === "hint" && (value.hint === "" || badPattern(value.hint))) || (!!error && f === "hint");
        return (
          <td key={f} className={`border-b border-ink/10 px-1.5 py-1.5 ${widths[f]}`}>
            <Field
              isPattern={f === "hint"}
              aria-label={`${LABELS[f]} for puzzle ${problem.no}`}
              autoComplete="off"
              value={value[f]}
              placeholder={f === "answer" ? "No answer yet" : undefined}
              onChange={(e) => { setValue((v) => ({ ...v, [f]: e.target.value })); setError(""); }}
              onKeyDown={(e) => {
                if (e.key === "Enter") e.currentTarget.blur();
                if (e.key === "Escape") { setValue({ hint: problem.hint, clue: problem.clue, answer: problem.answer }); setError(""); }
              }}
              className={`${inputBase} ${f === "hint" ? "font-extrabold tracking-[.04em]" : ""} ${
                f === "answer" ? "text-red placeholder:font-normal placeholder:text-[#8a5a00]" : ""
              } ${bad ? "border-red bg-[#fdeceb]" : "border-transparent bg-transparent hover:border-ink/15"}`}
            />
            {f === "hint" && error && <div className="px-2 text-sm text-red">{error}</div>}
          </td>
        );
      })}
      <td className="w-[3em] border-b border-ink/10 px-2.5 py-2 text-right">
        <button
          onClick={remove}
          aria-label={`Delete puzzle ${problem.no}`}
          className={`rounded-full border px-2.5 py-1 text-sm font-semibold transition ${
            confirm
              ? "border-red bg-red text-white"
              : "border-ink/20 text-muted hover:bg-[#fdeceb] hover:text-red"
          }`}
        >
          {confirm ? "Sure?" : "Delete"}
        </button>
      </td>
    </tr>
  );
}

function NewRow({
  nextNo,
  onChange,
  flash,
}: {
  nextNo: number;
  onChange: (p: Problem[]) => void;
  flash: (t: string) => void;
}) {
  const [value, setValue] = useState<ProblemInput>(EMPTY);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const firstRef = useRef<HTMLInputElement>(null);

  const add = async () => {
    let clean: ProblemInput;
    try { clean = checkProblem(value); } catch (e) { setError((e as Error).message); return; }
    setBusy(true);
    try {
      onChange(await api("/api/problems", "POST", clean));
      setValue(EMPTY);
      flash(`Added puzzle ${nextNo}`);
    } catch (e) {
      setError((e as Error).message);
    }
    setBusy(false);
    firstRef.current?.focus();
  };

  return (
    <tr className="bg-[#f3efe4] align-top">
      <td className="w-[3em] px-2.5 py-3 font-mono text-red">{nextNo}</td>
      {FIELDS.map((f) => (
        <td key={f} className={`px-1.5 py-2 ${widths[f]}`}>
          <Field
            isPattern={f === "hint"}
            ref={f === "hint" ? firstRef : undefined}
            id={`new-${f}`}
            aria-label={`New puzzle ${LABELS[f].toLowerCase()}`}
            placeholder={PLACEHOLDERS[f]}
            autoComplete="off"
            value={value[f]}
            onChange={(e) => { setValue((v) => ({ ...v, [f]: e.target.value })); setError(""); }}
            onKeyDown={(e) => { if (e.key === "Enter") add(); }}
            className={`${inputBase} ${f === "hint" ? "font-extrabold tracking-[.04em]" : ""} ${
              (f === "hint" && (badPattern(value.hint) || error)) ? "border-red bg-[#fdeceb]" : "border-ink/20 bg-white"
            }`}
          />
          {f === "hint" && error && <div className="px-2 text-sm text-red">{error}</div>}
        </td>
      ))}
      <td className="px-2.5 py-2 text-right">
        <button
          onClick={add}
          disabled={busy}
          className="rounded-full border-2 border-ink bg-ink px-3.5 py-1.5 text-sm font-semibold text-card transition hover:bg-[#333d3a] disabled:opacity-40"
        >
          Add
        </button>
      </td>
    </tr>
  );
}
