"use client";
import ReactMarkdown from "react-markdown";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import { useState } from "react";

type Difficulty = "Easy" | "Medium" | "Hard";
type Mode = "autopilot" | "coach";

type Subject = {
  id: string;
  name: string;
  examDate: string;
  difficulty: Difficulty;
};

type ProjectDeadline = {
  id: string;
  title: string;
  dueDate: string;
};

// Updated to match API: question_md / choices_md
type GeneratedQuestion = {
  id: string;
  type: "mcq" | "short";
  question_md: string;
  choices_md?: string[];
  answer_key?: string;
  concept_tag?: string;
};

type DiagnosticAnswerMap = Record<
  string,
  { answer: string; noIdea: boolean }
>;

type AnalysisWeakness = {
  concept_tag: string;
  severity: "high" | "medium" | "low";
  description?: string;
};

type Analysis = {
  mastery_percent: number;
  weaknesses: AnalysisWeakness[];
  predicted_score?: {
    today: number;
    after_7_days: number;
    after_fixing_top3: number;
  };
  recommended_mode: "Autopilot" | "Coach";
  mode_reasoning: string;
  strong_learner?: boolean;
  careless_patterns?: string[];
};

const STEPS = ["Setup", "Diagnostic", "Insights", "Plan"] as const;
type StepIndex = 0 | 1 | 2 | 3;

const INPUT =
  "rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm text-stone-900 placeholder-stone-400 outline-none transition focus:border-stone-500 focus:ring-1 focus:ring-stone-400";
const LABEL = "block text-sm font-medium text-stone-700";
const CARD = "rounded-xl border border-stone-200 bg-white p-4 shadow-sm";

function generateId() {
  return Math.random().toString(36).slice(2, 11);
}

function MD({ children }: { children: string }) {
  return (
    <div className="prose prose-sm max-w-none prose-stone">
      <ReactMarkdown remarkPlugins={[remarkMath]} rehypePlugins={[rehypeKatex]}>
        {children}
      </ReactMarkdown>
    </div>
  );
}

export default function StudyPlannerPage() {
  const [step, setStep] = useState<StepIndex>(0);

  // Setup
  const [subjects, setSubjects] = useState<Subject[]>([
    { id: generateId(), name: "", examDate: "", difficulty: "Medium" },
  ]);
  const [dailyHours, setDailyHours] = useState<number>(2);
  // User-selected mode (Autopilot/Coach). Source of truth for plan/practice API calls.
  const [mode, setMode] = useState<Mode>("autopilot");
  const [projectDeadlines, setProjectDeadlines] = useState<ProjectDeadline[]>(
    []
  );

  // Diagnostic
  const [selectedSubjectId, setSelectedSubjectId] = useState<string | null>(
    null
  );

  // generated questions from API or cache
  const [generatedQuestions, setGeneratedQuestions] = useState<
    GeneratedQuestion[] | null
  >(null);

  // User responses keyed by question id
  const [diagnosticAnswers, setDiagnosticAnswers] =
    useState<DiagnosticAnswerMap>({});

  const [isGenerating, setIsGenerating] = useState(false);
  const [genError, setGenError] = useState<string | null>(null);

  // Analysis (from /api/analyze-answers)
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analyzeError, setAnalyzeError] = useState<string | null>(null);
  // AI recommendation for display/guidance only; never used for API calls (use `mode`).
  const [aiRecommendedMode, setAiRecommendedMode] = useState<
    "autopilot" | "coach" | null
  >(null);
  const [modeReasoning, setModeReasoning] = useState("");

  const currentSubject = subjects.find((s) => s.id === selectedSubjectId);
  const selectedSubjectDisplay = currentSubject?.name || "Select a subject";

  const addSubject = () => {
    setSubjects((prev) => [
      ...prev,
      { id: generateId(), name: "", examDate: "", difficulty: "Medium" },
    ]);
  };

  const updateSubject = (id: string, field: keyof Subject, value: string) => {
    setSubjects((prev) =>
      prev.map((s) => (s.id === id ? { ...s, [field]: value } : s))
    );
  };

  const removeSubject = (id: string) => {
    if (subjects.length <= 1) return;
    setSubjects((prev) => prev.filter((s) => s.id !== id));
    if (selectedSubjectId === id) setSelectedSubjectId(null);
  };

  const addDeadline = () => {
    setProjectDeadlines((prev) => [
      ...prev,
      { id: generateId(), title: "", dueDate: "" },
    ]);
  };

  const updateDeadline = (
    id: string,
    field: keyof ProjectDeadline,
    value: string
  ) => {
    setProjectDeadlines((prev) =>
      prev.map((d) => (d.id === id ? { ...d, [field]: value } : d))
    );
  };

  const removeDeadline = (id: string) => {
    setProjectDeadlines((prev) => prev.filter((d) => d.id !== id));
  };

  const setAnswer = (
    qid: string,
    patch: Partial<{ answer: string; noIdea: boolean }>
  ) => {
    setDiagnosticAnswers((prev) => ({
      ...prev,
      [qid]: {
        ...(prev[qid] ?? { answer: "", noIdea: false }),
        ...patch,
      },
    }));
  };

  const goNext = () => {
    if (step < 3) setStep((step + 1) as StepIndex);
  };

  const goBack = () => {
    if (step > 0) setStep((step - 1) as StepIndex);
  };

  const fetchDiagnostic = async (count: number) => {
    const res = await fetch("/api/generate-diagnostic", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        subject: currentSubject!.name || "Untitled Subject",
        difficulty: currentSubject!.difficulty,
        examDate: currentSubject!.examDate,
        mode: mode === "autopilot" ? "Autopilot" : "Coach",
        count,
      }),
    });
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data?.detail || data?.error || "Failed to generate.");
    }
    return data.questions as GeneratedQuestion[];
  };

  const generateDiagnostic = async () => {
    if (!currentSubject) return;

    setIsGenerating(true);
    setGenError(null);

    try {
      const questions = await fetchDiagnostic(7);
      const normalized = questions.map((q, idx) => ({
        ...q,
        id: `${Date.now()}-${idx}`,
      }));
      setGeneratedQuestions(normalized);
      setDiagnosticAnswers({});
      setAnalysis(null);
      setAiRecommendedMode(null);
      setModeReasoning("");
      setAnalyzeError(null);
    } catch (e: unknown) {
      setGenError(
        e instanceof Error ? e.message : "Failed to generate diagnostic."
      );
    } finally {
      setIsGenerating(false);
    }
  };

  const analyzeAnswers = async () => {
    if (!currentSubject || !generatedQuestions) return;

    setIsAnalyzing(true);
    setAnalyzeError(null);

    try {
      const res = await fetch("/api/analyze-answers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          subject: currentSubject.name,
          difficulty: currentSubject.difficulty,
          mode: mode === "autopilot" ? "Autopilot" : "Coach",
          questions: generatedQuestions,
          answers: generatedQuestions.map(
            (gq) => diagnosticAnswers[gq.id] ?? { answer: "", noIdea: false }
          ),
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.detail || data?.error || "Failed to analyze answers.");
      }

      setAnalysis(data);
      setAiRecommendedMode(
        data.recommended_mode === "Autopilot" ? "autopilot" : "coach"
      );
      setModeReasoning(data.mode_reasoning ?? "");
      setStep(2);
    } catch (e: unknown) {
      setAnalyzeError(
        e instanceof Error ? e.message : "Failed to analyze answers."
      );
    } finally {
      setIsAnalyzing(false);
    }
  };

  return (
    <main className="min-h-screen bg-stone-50 text-stone-900 flex flex-col items-center p-6 pb-12">
      <div className="w-full max-w-2xl space-y-6">
        <header className="text-center">
          <h1 className="text-2xl font-semibold tracking-tight text-stone-800">
            AI Study Planner Engine
          </h1>
          <p className="mt-1.5 text-sm text-stone-500">
            Setup → Diagnostic → Insights → Plan
          </p>
        </header>

        {/* Step progress indicator */}
        <nav
          className="flex items-center justify-between rounded-xl border border-stone-200 bg-white px-2 py-3 shadow-sm"
          aria-label="Progress"
        >
          {STEPS.map((name, i) => (
            <div key={name} className="flex flex-1 items-center">
              <button
                type="button"
                onClick={() => setStep(i as StepIndex)}
                className={`rounded-lg px-2 py-1.5 text-sm font-medium transition ${
                  step === i
                    ? "bg-stone-800 text-white"
                    : "text-stone-500 hover:bg-stone-100 hover:text-stone-700"
                }`}
              >
                {name}
              </button>
              {i < STEPS.length - 1 && (
                <span
                  className={`mx-1 h-px flex-1 max-w-8 ${
                    step > i ? "bg-stone-400" : "bg-stone-200"
                  }`}
                  aria-hidden
                />
              )}
            </div>
          ))}
        </nav>

        <div className={CARD}>
          {/* Step 0: Setup */}
          {step === 0 && (
            <div className="space-y-6">
              <h2 className="text-lg font-medium text-stone-800">Setup</h2>

              {/* Subjects */}
              <div>
                <div className="flex items-center justify-between">
                  <label className={LABEL}>Subjects</label>
                  <button
                    type="button"
                    onClick={addSubject}
                    className="text-sm font-medium text-stone-600 hover:text-stone-800"
                  >
                    + Add subject
                  </button>
                </div>
                <div className="mt-2 space-y-3">
                  {subjects.map((s) => (
                    <div
                      key={s.id}
                      className="flex flex-wrap items-end gap-2 rounded-lg border border-stone-200 bg-stone-50/50 p-3"
                    >
                      <input
                        type="text"
                        value={s.name}
                        onChange={(e) =>
                          updateSubject(s.id, "name", e.target.value)
                        }
                        placeholder="Subject name"
                        className={`${INPUT} flex-1 min-w-[120px]`}
                      />
                      <input
                        type="date"
                        value={s.examDate}
                        onChange={(e) =>
                          updateSubject(s.id, "examDate", e.target.value)
                        }
                        className={INPUT}
                      />
                      <select
                        value={s.difficulty}
                        onChange={(e) =>
                          updateSubject(
                            s.id,
                            "difficulty",
                            e.target.value as Difficulty
                          )
                        }
                        className={INPUT}
                      >
                        <option value="Easy">Easy</option>
                        <option value="Medium">Medium</option>
                        <option value="Hard">Hard</option>
                      </select>
                      <button
                        type="button"
                        onClick={() => removeSubject(s.id)}
                        disabled={subjects.length <= 1}
                        className="rounded-lg px-2 py-1.5 text-sm text-stone-500 hover:bg-stone-200 hover:text-stone-700 disabled:opacity-50 disabled:hover:bg-transparent"
                      >
                        Remove
                      </button>
                    </div>
                  ))}
                </div>
              </div>

              {/* Daily hours */}
              <div>
                <label htmlFor="daily-hours" className={LABEL}>
                  Daily available study hours
                </label>
                <input
                  id="daily-hours"
                  type="number"
                  min={0.5}
                  max={24}
                  step={0.5}
                  value={dailyHours}
                  onChange={(e) =>
                    setDailyHours(
                      Math.max(0, Math.min(24, Number(e.target.value) || 0))
                    )
                  }
                  className={`mt-1.5 w-full ${INPUT}`}
                />
              </div>

              {/* Mode */}
              <div>
                <span className={LABEL}>Mode</span>
                <div className="mt-2 flex rounded-lg border border-stone-300 bg-stone-100/50 p-1">
                  <button
                    type="button"
                    onClick={() => setMode("autopilot")}
                    className={`flex-1 rounded-md px-3 py-2 text-sm font-medium transition ${
                      mode === "autopilot"
                        ? "bg-white text-stone-900 shadow-sm"
                        : "text-stone-600 hover:text-stone-900"
                    }`}
                  >
                    Autopilot
                  </button>
                  <button
                    type="button"
                    onClick={() => setMode("coach")}
                    className={`flex-1 rounded-md px-3 py-2 text-sm font-medium transition ${
                      mode === "coach"
                        ? "bg-white text-stone-900 shadow-sm"
                        : "text-stone-600 hover:text-stone-900"
                    }`}
                  >
                    Coach
                  </button>
                </div>
                <p className="mt-1.5 text-xs text-stone-500">
                  {mode === "autopilot"
                    ? "AI manages everything"
                    : "AI acts as assistant"}
                </p>
              </div>

              {/* Optional project deadlines */}
              <div>
                <div className="flex items-center justify-between">
                  <label className={LABEL}>Project deadlines (optional)</label>
                  <button
                    type="button"
                    onClick={addDeadline}
                    className="text-sm font-medium text-stone-600 hover:text-stone-800"
                  >
                    + Add deadline
                  </button>
                </div>
                {projectDeadlines.length === 0 ? (
                  <p className="mt-1.5 text-sm text-stone-500">
                    No deadlines added.
                  </p>
                ) : (
                  <div className="mt-2 space-y-2">
                    {projectDeadlines.map((d) => (
                      <div
                        key={d.id}
                        className="flex flex-wrap items-center gap-2"
                      >
                        <input
                          type="text"
                          value={d.title}
                          onChange={(e) =>
                            updateDeadline(d.id, "title", e.target.value)
                          }
                          placeholder="Title"
                          className={`${INPUT} flex-1 min-w-[140px]`}
                        />
                        <input
                          type="date"
                          value={d.dueDate}
                          onChange={(e) =>
                            updateDeadline(d.id, "dueDate", e.target.value)
                          }
                          className={INPUT}
                        />
                        <button
                          type="button"
                          onClick={() => removeDeadline(d.id)}
                          className="rounded-lg px-2 py-1.5 text-sm text-stone-500 hover:bg-stone-200 hover:text-stone-700"
                        >
                          Remove
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Step 1: Diagnostic */}
          {step === 1 && (
            <div className="space-y-6">
              <h2 className="text-lg font-medium text-stone-800">Diagnostic</h2>

              <div>
                <label className={LABEL}>Select subject</label>
                <select
                  value={selectedSubjectId ?? ""}
                  onChange={(e) => {
                    const next = e.target.value || null;
                    setSelectedSubjectId(next);
                    setGeneratedQuestions(null);
                    setGenError(null);
                    setAnalysis(null);
                    setAiRecommendedMode(null);
                    setModeReasoning("");
                    setAnalyzeError(null);
                  }}
                  className={`mt-1.5 w-full ${INPUT}`}
                >
                  <option value="">— Select a subject —</option>
                  {subjects.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name || `Subject (no name)`}
                    </option>
                  ))}
                </select>
              </div>

              {selectedSubjectId && (
                <div className="space-y-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <p className="text-sm text-stone-600">
                      Generate and answer questions for{" "}
                      <strong>{selectedSubjectDisplay}</strong>.
                    </p>

                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={generateDiagnostic}
                        disabled={isGenerating || !currentSubject?.name}
                        className="rounded-lg bg-stone-800 px-4 py-2 text-sm font-medium text-white transition hover:bg-stone-700 disabled:opacity-50 disabled:pointer-events-none"
                      >
                        Generate Diagnostic
                      </button>
                      <button
                        type="button"
                        onClick={generateDiagnostic}
                        disabled={isGenerating || !currentSubject?.name}
                        className="text-sm font-medium text-stone-500 hover:text-stone-700 disabled:opacity-50 disabled:pointer-events-none"
                      >
                        Regenerate
                      </button>
                    </div>
                  </div>

                  {!currentSubject?.name && (
                    <p className="text-xs text-stone-500">
                      Please name the subject in Setup first.
                    </p>
                  )}

                  {genError && (
                    <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                      {genError}
                    </div>
                  )}

                  {generatedQuestions && generatedQuestions.length > 0 && (
                    <div className="space-y-3">
                      {generatedQuestions.map((gq, i) => {
                        const ans =
                          diagnosticAnswers[gq.id] ?? {
                            answer: "",
                            noIdea: false,
                          };
                        return (
                        <div
                          key={gq.id}
                          className="rounded-lg border border-stone-200 bg-stone-50/50 p-3 space-y-3"
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div className="space-y-1">
                              <div className="text-sm font-medium text-stone-700">
                                Question {i + 1}
                              </div>
                              <MD>{gq.question_md}</MD>
                            </div>
                            <span className="shrink-0 rounded-full bg-stone-200 px-2 py-1 text-xs text-stone-700">
                              {gq.type.toUpperCase()}
                            </span>
                          </div>

                          {/* MCQ */}
                          {gq.type === "mcq" && gq.choices_md ? (
                            <div className="space-y-2">
                              {gq.choices_md.map((choice, idx) => {
                                const m = choice.match(/[ABCD]/);
                                const letter = m ? m[0] : String(idx);
                                return (
                                  <label
                                    key={idx}
                                    className={`flex items-start gap-2 rounded-lg border border-stone-200 bg-white px-3 py-2 hover:bg-stone-50 ${ans.noIdea ? "pointer-events-none opacity-60" : ""}`}
                                  >
                                    <input
                                      type="radio"
                                      name={`mcq-${gq.id}`}
                                      value={letter}
                                      checked={ans.answer === letter}
                                      onChange={(e) =>
                                        setAnswer(gq.id, { answer: e.target.value })
                                      }
                                      disabled={ans.noIdea}
                                      className="mt-1"
                                    />
                                    <div className="flex-1">
                                      <MD>{choice}</MD>
                                    </div>
                                  </label>
                                );
                              })}
                            </div>
                          ) : (
                            /* Short answer */
                            <input
                              type="text"
                              value={ans.answer}
                              onChange={(e) =>
                                setAnswer(gq.id, { answer: e.target.value })
                              }
                              placeholder="Your answer..."
                              disabled={ans.noIdea}
                              className={`w-full ${INPUT} disabled:opacity-60 disabled:cursor-not-allowed`}
                            />
                          )}

                          {/* No idea */}
                          <div className="space-y-1">
                            <label className="flex items-center gap-2 text-sm text-stone-600">
                              <input
                                type="checkbox"
                                checked={ans.noIdea}
                                onChange={(e) => {
                                  const checked = e.target.checked;
                                  setAnswer(gq.id, {
                                    noIdea: checked,
                                    answer: checked ? "" : ans.answer,
                                  });
                                }}
                                className="rounded border-stone-300"
                              />
                              No idea
                            </label>
                            {ans.noIdea && (
                              <p className="text-xs text-stone-500 pl-6">
                                Marked as &apos;No idea&apos; — we&apos;ll treat this as a gap to focus on.
                              </p>
                            )}
                          </div>
                        </div>
                      );
                      })}
                    </div>
                  )}

                  {isGenerating && (generatedQuestions?.length ?? 0) < 7 && (
                    <div className="space-y-3">
                      <p className="text-sm text-stone-500">
                        {generatedQuestions?.length
                          ? "Loading remaining questions…"
                          : "Generating adaptive questions (usually 5–10s)…"}
                      </p>
                      {Array.from({
                        length: 7 - (generatedQuestions?.length ?? 0),
                      }).map((_, i) => (
                        <div
                          key={`skeleton-${i}`}
                          className="rounded-lg border border-stone-200 bg-stone-100/80 p-4 space-y-3 animate-pulse"
                        >
                          <div className="h-4 w-1/3 rounded bg-stone-300" />
                          <div className="space-y-2">
                            <div className="h-3 w-full rounded bg-stone-200" />
                            <div className="h-3 w-4/5 rounded bg-stone-200" />
                          </div>
                          <div className="flex gap-2">
                            <div className="h-9 flex-1 rounded-lg bg-stone-200" />
                            <div className="h-9 flex-1 rounded-lg bg-stone-200" />
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  {generatedQuestions && generatedQuestions.length === 7 && !isGenerating && (
                    <div className="space-y-2">
                      <button
                        type="button"
                        onClick={analyzeAnswers}
                        disabled={isAnalyzing}
                        className="w-full rounded-lg bg-stone-800 py-2.5 text-sm font-medium text-white transition hover:bg-stone-700 disabled:opacity-50 disabled:pointer-events-none"
                      >
                        {isAnalyzing ? "Analyzing…" : "Analyze Answers"}
                      </button>
                      {analyzeError && (
                        <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                          {analyzeError}
                        </div>
                      )}
                    </div>
                  )}

                  {(!generatedQuestions || generatedQuestions.length === 0) && !isGenerating && (
                    <div className="rounded-lg border border-stone-200 bg-white p-3 text-sm text-stone-500">
                      Click <strong>Generate Diagnostic</strong> to create 7
                      questions.
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Step 2: Insights */}
          {step === 2 && (
            <div className="space-y-6">
              <h2 className="text-lg font-medium text-stone-800">Insights</h2>

              {/* AI Recommendation: Learning Mode */}
              {analysis && (
                <div className={`${CARD} border-stone-300 bg-stone-50/50`}>
                  <h3 className="text-base font-semibold text-stone-800">
                    AI Recommendation: Learning Mode
                  </h3>
                  <p className="mt-1 text-xs text-stone-500">
                    Guidance only. Your selected mode (Setup or below) is used for your plan.
                  </p>
                  <p className="mt-1 text-sm font-medium text-stone-700">
                    {analysis.recommended_mode}
                  </p>
                  <p className="mt-2 text-sm text-stone-600">
                    {modeReasoning || analysis.mode_reasoning}
                  </p>
                  <div className="mt-4 flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() =>
                        setMode(aiRecommendedMode ?? "autopilot")
                      }
                      className="rounded-lg bg-stone-800 px-4 py-2 text-sm font-medium text-white transition hover:bg-stone-700"
                    >
                      Accept Recommendation
                    </button>
                    <button
                      type="button"
                      onClick={() => {}}
                      className="rounded-lg border border-stone-300 bg-white px-4 py-2 text-sm font-medium text-stone-700 transition hover:bg-stone-50"
                    >
                      Keep My Current Mode
                    </button>
                  </div>
                  {aiRecommendedMode !== null && mode !== aiRecommendedMode && (
                    <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50/80 p-3 text-sm text-amber-900">
                      {mode === "coach" && aiRecommendedMode === "autopilot"
                        ? "Coach mode selected. Note: based on your diagnostic profile, progress may be slower compared to Autopilot."
                        : "Autopilot mode selected. Note: based on your profile, Coach mode may be sufficient and more flexible."}
                    </div>
                  )}
                </div>
              )}

              <div className="grid gap-4 sm:grid-cols-2">
                <div className={CARD}>
                  <h3 className="text-sm font-medium text-stone-600">
                    Mastery %
                  </h3>
                  {analysis ? (
                    <p className="mt-2 text-2xl font-semibold text-stone-800">
                      {analysis.mastery_percent}%
                    </p>
                  ) : (
                    <p className="mt-2 text-sm text-stone-500">
                      Complete the diagnostic and analyze answers to see
                      mastery.
                    </p>
                  )}
                </div>
                <div className={CARD}>
                  <h3 className="text-sm font-medium text-stone-600">
                    Weaknesses
                  </h3>
                  {analysis && analysis.weaknesses.length > 0 ? (
                    <ul className="mt-2 space-y-2">
                      {analysis.weaknesses.map((w, i) => (
                        <li
                          key={i}
                          className="flex flex-wrap items-start gap-2 text-sm"
                        >
                          <span
                            className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${
                              w.severity === "high"
                                ? "bg-red-100 text-red-800"
                                : w.severity === "medium"
                                  ? "bg-amber-100 text-amber-800"
                                  : "bg-stone-200 text-stone-700"
                            }`}
                          >
                            {w.severity}
                          </span>
                          <span className="font-medium text-stone-700">
                            {w.concept_tag}
                          </span>
                          {w.description && (
                            <span className="text-stone-600">
                              — {w.description}
                            </span>
                          )}
                        </li>
                      ))}
                    </ul>
                  ) : analysis ? (
                    <p className="mt-2 text-sm text-stone-500">
                      No weaknesses identified.
                    </p>
                  ) : (
                    <p className="mt-2 text-sm text-stone-500">
                      Topics to focus on will appear here after analysis.
                    </p>
                  )}
                </div>
              </div>

              <div className={CARD}>
                <h3 className="text-sm font-medium text-stone-600">
                  Predicted Score
                </h3>
                <div className="mt-3 flex flex-wrap gap-4">
                  <div className="rounded-lg bg-stone-100 px-3 py-2">
                    <span className="text-xs text-stone-500">Today</span>
                    <p className="text-lg font-semibold text-stone-800">
                      {analysis?.predicted_score?.today != null
                        ? `${analysis.predicted_score.today}%`
                        : "— %"}
                    </p>
                  </div>
                  <div className="rounded-lg bg-stone-100 px-3 py-2">
                    <span className="text-xs text-stone-500">After 7 days</span>
                    <p className="text-lg font-semibold text-stone-800">
                      {analysis?.predicted_score?.after_7_days != null
                        ? `${analysis.predicted_score.after_7_days}%`
                        : "— %"}
                    </p>
                  </div>
                  <div className="rounded-lg bg-stone-100 px-3 py-2">
                    <span className="text-xs text-stone-500">After fixing top 3</span>
                    <p className="text-lg font-semibold text-stone-800">
                      {analysis?.predicted_score?.after_fixing_top3 != null
                        ? `${analysis.predicted_score.after_fixing_top3}%`
                        : "— %"}
                    </p>
                  </div>
                </div>
              </div>

              {analysis?.strong_learner != null && (
                <div className={CARD}>
                  <h3 className="text-sm font-medium text-stone-600">
                    Strong Learner
                  </h3>
                  <p className="mt-2 text-sm text-stone-700">
                    {analysis.strong_learner
                      ? "Your profile suggests strong learning habits; Coach mode can help you stay in control while still getting guidance."
                      : "Focus on core gaps first; Autopilot can help structure your practice until foundations are solid."}
                  </p>
                </div>
              )}

              {analysis?.careless_patterns != null &&
                analysis.careless_patterns.length > 0 && (
                  <div className={CARD}>
                    <h3 className="text-sm font-medium text-stone-600">
                      Careless patterns
                    </h3>
                    <ul className="mt-2 list-inside list-disc space-y-1 text-sm text-stone-600">
                      {analysis.careless_patterns.map((p, i) => (
                        <li key={i}>{p}</li>
                      ))}
                    </ul>
                  </div>
                )}

              {(!analysis || analysis.strong_learner == null) && (
                <div className={CARD}>
                  <h3 className="text-sm font-medium text-stone-600">
                    Strong Learner Tools
                  </h3>
                  <p className="mt-2 text-sm text-stone-500">
                    {analysis
                      ? "Recommended tools and techniques will appear here when available."
                      : "Complete the diagnostic and analyze answers to see recommendations."}
                  </p>
                </div>
              )}
            </div>
          )}

          {/* Step 3: Plan */}
          {step === 3 && (
            <div className="space-y-6">
              <h2 className="text-lg font-medium text-stone-800">Plan</h2>

              <div className="overflow-x-auto">
                <h3 className="text-sm font-medium text-stone-600 mb-2">
                  7-day schedule
                </h3>
                <table className="w-full min-w-[400px] border-collapse text-sm">
                  <thead>
                    <tr className="border-b border-stone-200">
                      <th className="text-left py-2 font-medium text-stone-700">
                        Day
                      </th>
                      <th className="text-left py-2 font-medium text-stone-700">
                        Focus
                      </th>
                      <th className="text-left py-2 font-medium text-stone-700">
                        Hours
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {[1, 2, 3, 4, 5, 6, 7].map((d) => (
                      <tr
                        key={d}
                        className="border-b border-stone-100 text-stone-600"
                      >
                        <td className="py-2">Day {d}</td>
                        <td className="py-2">—</td>
                        <td className="py-2">—</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className={CARD}>
                <h3 className="text-sm font-medium text-stone-600">
                  Study method recommendations
                </h3>
                <p className="mt-2 text-sm text-stone-500">
                  Placeholder: recommended methods will appear here.
                </p>
              </div>

              <div className={CARD}>
                <h3 className="text-sm font-medium text-stone-600">
                  Practice set
                </h3>
                <p className="mt-2 text-sm text-stone-500">
                  Placeholder: practice exercises and sets will appear here.
                </p>
              </div>

              <button
                type="button"
                className="w-full rounded-lg border border-stone-300 bg-white py-2.5 text-sm font-medium text-stone-700 transition hover:bg-stone-50 focus:outline-none focus:ring-2 focus:ring-stone-400 focus:ring-offset-2"
              >
                Export .ics
              </button>
            </div>
          )}

          {/* Step navigation */}
          <div className="mt-6 flex justify-between gap-3 border-t border-stone-200 pt-4">
            <button
              type="button"
              onClick={goBack}
              disabled={step === 0}
              className="rounded-lg border border-stone-300 bg-white px-4 py-2 text-sm font-medium text-stone-700 transition hover:bg-stone-50 disabled:opacity-50 disabled:pointer-events-none"
            >
              Back
            </button>
            <button
              type="button"
              onClick={goNext}
              disabled={step === 3}
              className="rounded-lg bg-stone-800 px-4 py-2 text-sm font-medium text-white transition hover:bg-stone-700 disabled:opacity-50 disabled:pointer-events-none"
            >
              Next
            </button>
          </div>
        </div>
      </div>
    </main>
  );
}