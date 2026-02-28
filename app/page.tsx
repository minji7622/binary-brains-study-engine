"use client";
import ReactMarkdown from "react-markdown";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import Image from "next/image";
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
  "rounded-xl border-2 border-blue-200 bg-white px-3.5 py-2.5 text-base text-gray-900 placeholder-gray-400 outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-200";
const LABEL = "block text-base font-semibold text-gray-900";
const CARD = "rounded-2xl border-2 border-blue-200/80 bg-white p-5 shadow-lg shadow-blue-100/50";

function generateId() {
  return Math.random().toString(36).slice(2, 11);
}

function MD({ children }: { children: string }) {
  return (
    <div className="prose prose-base max-w-none prose-headings:text-gray-900 prose-p:text-gray-900 prose-strong:text-gray-900">
      <ReactMarkdown remarkPlugins={[remarkMath]} rehypePlugins={[rehypeKatex]}>
        {children}
      </ReactMarkdown>
    </div>
  );
}

function getModeCallout(
  userSelectedMode: "autopilot" | "coach",
  recommendedMode: "autopilot" | "coach"
): { title: string; body: string; variant: "success" | "recommend" } {
  const modeName = (m: string) => (m === "autopilot" ? "Autopilot" : "Coach");
  if (recommendedMode === userSelectedMode) {
    return {
      title: `Great choice — ${modeName(userSelectedMode)} fits your profile.`,
      body: "",
      variant: "success",
    };
  }
  const body =
    userSelectedMode === "coach" && recommendedMode === "autopilot"
      ? "Coach mode is totally okay, but progress may be slower unless you increase consistency."
      : "Autopilot is fine, but you may not need it — Coach gives you more control.";
  return {
    title: `Recommended: ${modeName(recommendedMode)}`,
    body,
    variant: "recommend",
  };
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
  const [diagnosticWarmingUp, setDiagnosticWarmingUp] = useState(false);
  const [diagnosticIsFallback, setDiagnosticIsFallback] = useState(false);

  // Analysis (from /api/analyze-answers)
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analyzeError, setAnalyzeError] = useState<string | null>(null);
  // AI recommendation for display/guidance only; never used for API calls (use `mode`).
  const [aiRecommendedMode, setAiRecommendedMode] = useState<
    "autopilot" | "coach" | null
  >(null);
  const [modeReasoning, setModeReasoning] = useState("");

  const [plan, setPlan] = useState<any | null>(null);
  const [isGeneratingPlan, setIsGeneratingPlan] = useState(false);
  const [planError, setPlanError] = useState<string | null>(null);
  const [planNotes, setPlanNotes] = useState("");
  const [planTodoChecked, setPlanTodoChecked] = useState<Record<number, boolean>>({});
  const [planTopicsChecked, setPlanTopicsChecked] = useState<Record<number, boolean>>({});
  const [planWhyExpanded, setPlanWhyExpanded] = useState(false);

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

  const fetchDiagnostic = async (count: number): Promise<{ questions: GeneratedQuestion[]; meta?: { source?: string } }> => {
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
      throw new Error(data?.error || data?.detail || "Failed to generate.");
    }
    return {
      questions: (data.questions ?? []) as GeneratedQuestion[],
      meta: data.meta,
    };
  };

  const looksPlaceholder = (
    questions: GeneratedQuestion[],
    meta?: { source?: string }
  ): boolean => {
    if (meta?.source === "fallback") return true;
    if (!questions?.length) return false;
    const optionSet = ["Option A", "Option B", "Option C", "Option D"];
    return questions.every((q) => {
      if (q.type !== "mcq" || !q.choices_md?.length) return true;
      return (
        q.choices_md.length === 4 &&
        q.choices_md.every((c, i) => c === optionSet[i])
      );
    });
  };

  const generateDiagnostic = async () => {
    if (!currentSubject) return;

    setIsGenerating(true);
    setGenError(null);
    setDiagnosticIsFallback(false);

    try {
      let data = await fetchDiagnostic(7);
      let isFallback = looksPlaceholder(data.questions, data.meta);

      if (isFallback) {
        setDiagnosticWarmingUp(true);
        await new Promise((r) => setTimeout(r, 400));
        setDiagnosticWarmingUp(false);
        data = await fetchDiagnostic(7);
        isFallback = looksPlaceholder(data.questions, data.meta);
      }

      const normalized = data.questions.map((q, idx) => ({
        ...q,
        id: `${Date.now()}-${idx}`,
      }));
      setGeneratedQuestions(normalized);
      setDiagnosticAnswers({});
      setAnalysis(null);
      setAiRecommendedMode(null);
      setModeReasoning("");
      setAnalyzeError(null);
      setDiagnosticIsFallback(isFallback);
    } catch (e: unknown) {
      setGenError(
        e instanceof Error ? e.message : "Failed to generate diagnostic."
      );
    } finally {
      setIsGenerating(false);
    }
  };

  const generatePlan = async () => {
    if (!currentSubject || !analysis) return;
    setIsGeneratingPlan(true);
    setPlanError(null);
    try {
      const res = await fetch("/api/generate-plan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          subject: currentSubject.name,
          mastery_percent: analysis.mastery_percent,
          weaknesses: analysis.weaknesses,
          dailyHours,
          examDate: currentSubject.examDate,
          mode,
          subjects: subjects.map((s) => ({ name: s.name, examDate: s.examDate, difficulty: s.difficulty })),
          projectDeadlines: projectDeadlines.map((d) => ({ title: d.title, dueDate: d.dueDate })),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.detail ?? data?.error ?? "Failed to generate plan.");
      }
      setPlan(data);
      setStep(3);
    } catch (e: unknown) {
      setPlanError(
        e instanceof Error ? e.message : "Failed to generate study plan."
      );
    } finally {
      setIsGeneratingPlan(false);
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
    <main className="min-h-screen flex flex-col items-center bg-blue-50 text-gray-900 p-6 pb-12">
      <div className="w-full max-w-2xl space-y-6">
        {/* Brand row: mascot + NeuroPlan — transparent PNG on tinted background */}
        <header className="flex flex-col items-center gap-3 sm:flex-row sm:justify-center sm:gap-4">
          <div className="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-2xl bg-blue-100 shadow-md ring-2 ring-blue-200/80">
            <Image
              src="/branding/neuroplan-main.png"
              alt="NeuroPlan mascot"
              width={48}
              height={48}
              className="object-contain object-center"
            />
          </div>
          <div className="text-center sm:text-left">
            <h1 className="text-3xl font-bold tracking-tight text-gray-900">
              NeuroPlan
            </h1>
            <p className="mt-1 text-base text-gray-600">
              Adaptive diagnostics → personalized plans → calendar-ready.
            </p>
          </div>
        </header>

        {/* Step progress indicator */}
        <nav
          className="flex items-center justify-between rounded-2xl border-2 border-blue-200/80 bg-white px-3 py-3.5 shadow-md shadow-blue-100/40"
          aria-label="Progress"
        >
          {STEPS.map((name, i) => (
            <div key={name} className="flex flex-1 items-center">
              <button
                type="button"
                onClick={() => setStep(i as StepIndex)}
                className={`rounded-xl px-3 py-2 text-base font-semibold transition ${
                  step === i
                    ? "bg-blue-600 text-white shadow-sm"
                    : "text-blue-600 hover:bg-blue-100 hover:text-blue-800"
                }`}
              >
                {name}
              </button>
              {i < STEPS.length - 1 && (
                <span
                  className={`mx-1.5 h-px flex-1 max-w-10 ${
                    step > i ? "bg-blue-400" : "bg-blue-200"
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
            <div className="flex flex-col gap-6 md:flex-row md:items-start md:gap-8">
              <div className="min-w-0 flex-1 space-y-6 order-2 md:order-1">
                <h2 className="text-xl font-bold text-gray-900">Setup</h2>

                {/* Subjects */}
                <div>
                <div className="flex items-center justify-between">
                  <label className={LABEL}>Subjects</label>
                  <button
                    type="button"
                    onClick={addSubject}
                    className="text-base font-semibold text-blue-600 hover:text-blue-700"
                  >
                    + Add subject
                  </button>
                </div>
                <div className="mt-2 space-y-3">
                  {subjects.map((s) => (
                    <div
                      key={s.id}
                      className="flex flex-wrap items-end gap-2 rounded-xl border-2 border-blue-200/70 bg-blue-50/50 p-3.5"
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
                        className="rounded-lg px-3 py-2 text-base font-medium text-blue-600 hover:bg-blue-100 hover:text-blue-800 disabled:opacity-50 disabled:hover:bg-transparent"
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
                <div className="mt-2 flex rounded-xl border-2 border-blue-200 bg-blue-50/50 p-1.5">
                  <button
                    type="button"
                    onClick={() => setMode("autopilot")}
                    className={`flex-1 rounded-lg px-4 py-2.5 text-base font-semibold transition ${
                      mode === "autopilot"
                        ? "bg-blue-600 text-white shadow-sm"
                        : "text-blue-700 hover:bg-blue-100"
                    }`}
                  >
                    Autopilot
                  </button>
                  <button
                    type="button"
                    onClick={() => setMode("coach")}
                    className={`flex-1 rounded-lg px-4 py-2.5 text-base font-semibold transition ${
                      mode === "coach"
                        ? "bg-blue-600 text-white shadow-sm"
                        : "text-blue-700 hover:bg-blue-100"
                    }`}
                  >
                    Coach
                  </button>
                </div>
                <p className="mt-2 text-sm text-gray-600">
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
                    className="text-base font-semibold text-blue-600 hover:text-blue-700"
                  >
                    + Add deadline
                  </button>
                </div>
                {projectDeadlines.length === 0 ? (
                  <p className="mt-2 text-base text-blue-600">
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
                          className="rounded-lg px-3 py-2 text-base font-medium text-blue-600 hover:bg-blue-100 hover:text-blue-800"
                        >
                          Remove
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
              </div>

              {/* Mascot hero — transparent PNG on soft blue background */}
              <div className="order-1 flex justify-center md:order-2 md:w-[200px] md:shrink-0">
                <div className="flex h-[180px] w-[180px] max-w-[220px] items-center justify-center overflow-hidden rounded-2xl bg-gradient-to-br from-blue-100 to-blue-200 shadow-lg ring-2 ring-blue-200/60 sm:h-[200px] sm:w-[200px]">
                  <Image
                    src="/branding/neuroplan-main.png"
                    alt=""
                    width={200}
                    height={200}
                    className="object-contain object-center"
                  />
                </div>
              </div>
            </div>
          )}

          {/* Step 1: Diagnostic */}
          {step === 1 && (
            <div className="space-y-6">
              <h2 className="text-xl font-bold text-gray-900">Diagnostic</h2>

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
                    <div className="flex flex-wrap items-center gap-2">
                      <div className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-blue-100 shadow-sm ring-2 ring-blue-200/60">
                        <Image
                          src="/branding/neuroplan-chat.png"
                          alt=""
                          width={44}
                          height={44}
                          className="object-contain object-center"
                        />
                      </div>
                      <p className="text-base text-gray-900">
                        Generate and answer questions for{" "}
                        <strong className="text-gray-900">{selectedSubjectDisplay}</strong>.
                      </p>
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        onClick={generateDiagnostic}
                        disabled={isGenerating || !currentSubject?.name}
                        className="rounded-xl bg-blue-600 px-5 py-2.5 text-base font-semibold text-white shadow-sm transition hover:bg-blue-700 disabled:opacity-50 disabled:pointer-events-none"
                      >
                        Generate Diagnostic
                      </button>
                      <button
                        type="button"
                        onClick={generateDiagnostic}
                        disabled={isGenerating || !currentSubject?.name}
                        className="rounded-xl px-4 py-2.5 text-base font-semibold text-blue-600 hover:bg-blue-100 disabled:opacity-50 disabled:pointer-events-none"
                      >
                        Regenerate
                      </button>
                    </div>
                  </div>

                  {!currentSubject?.name && (
                    <p className="text-sm text-gray-600">
                      Please name the subject in Setup first.
                    </p>
                  )}

                  {genError && (
                    <div className="rounded-xl border-2 border-red-200 bg-red-50 p-4 text-base text-red-700">
                      {genError}
                    </div>
                  )}

                  {generatedQuestions && generatedQuestions.length > 0 && (
                    <div className="space-y-3">
                      {diagnosticIsFallback && (
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="inline-flex items-center rounded-full bg-amber-100 px-2.5 py-1 text-xs font-medium text-amber-800">
                            Instant set
                          </span>
                          <button
                            type="button"
                            onClick={generateDiagnostic}
                            disabled={isGenerating}
                            className="rounded-lg border border-amber-300 bg-white px-3 py-1.5 text-sm font-semibold text-amber-800 transition hover:bg-amber-50 disabled:opacity-50"
                          >
                            Regenerate
                          </button>
                        </div>
                      )}
                      {generatedQuestions.map((gq, i) => {
                        const ans =
                          diagnosticAnswers[gq.id] ?? {
                            answer: "",
                            noIdea: false,
                          };
                        const choices =
                          gq.choices_md ??
                          (gq as GeneratedQuestion & { choices?: string[] }).choices ??
                          [];
                        const isMcq = gq.type === "mcq" && choices.length >= 4;
                        const optionLetters = ["A", "B", "C", "D"] as const;
                        return (
                          <div
                            key={gq.id}
                            className="rounded-xl border-2 border-blue-200 bg-blue-50/50 p-4 space-y-3"
                          >
                            <div className="flex items-start justify-between gap-3">
                              <div className="space-y-1">
                                <div className="text-base font-semibold text-gray-900">
                                  Question {i + 1}
                                </div>
                                <MD>{gq.question_md ?? (gq as GeneratedQuestion & { question?: string }).question ?? ""}</MD>
                              </div>
                              <span className="shrink-0 rounded-full bg-blue-200 px-2.5 py-1 text-sm font-semibold text-blue-800">
                                {gq.type.toUpperCase()}
                              </span>
                            </div>

                            {isMcq ? (
                              <div className="space-y-2" role="radiogroup" aria-label={`Question ${i + 1} options`}>
                                {choices.slice(0, 4).map((choice, idx) => {
                                  const letter = optionLetters[idx] ?? "A";
                                  return (
                                    <label
                                      key={`${gq.id}-${idx}`}
                                      className={`flex items-start gap-2 rounded-xl border-2 border-blue-200 bg-white px-3.5 py-2.5 hover:bg-blue-50 cursor-pointer ${ans.noIdea ? "pointer-events-none opacity-60" : ""}`}
                                    >
                                      <input
                                        type="radio"
                                        name={gq.id}
                                        value={letter}
                                        checked={ans.answer === letter}
                                        onChange={() =>
                                          setAnswer(gq.id, {
                                            answer: letter,
                                            noIdea: ans.noIdea,
                                          })
                                        }
                                        disabled={ans.noIdea}
                                        className="mt-1 cursor-pointer"
                                      />
                                      <span className="text-base font-medium text-gray-700 shrink-0">{letter}.</span>
                                      <div className="flex-1 min-w-0">
                                        <MD>{choice}</MD>
                                      </div>
                                    </label>
                                  );
                                })}
                              </div>
                            ) : (
                              <textarea
                                value={ans.answer}
                                onChange={(e) =>
                                  setAnswer(gq.id, {
                                    answer: e.target.value,
                                    noIdea: ans.noIdea,
                                  })
                                }
                                placeholder="Your answer..."
                                disabled={ans.noIdea}
                                rows={3}
                                className={`w-full ${INPUT} disabled:opacity-60 disabled:cursor-not-allowed resize-y min-h-[80px]`}
                              />
                            )}

                            <div className="space-y-1">
                              <label className="flex items-center gap-2 text-base text-gray-900">
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
                                  className="h-4 w-4 rounded border-blue-300 text-blue-600 focus:ring-blue-300"
                                />
                                No idea
                              </label>
                              {ans.noIdea && (
                                <p className="text-sm text-gray-600 pl-6">
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
                      <p className="text-base text-gray-600">
                        {diagnosticWarmingUp
                          ? "Warming up model…"
                          : generatedQuestions?.length
                            ? "Loading remaining questions…"
                            : "Generating adaptive questions (taking some time)…"}
                      </p>
                      {Array.from({
                        length: 7 - (generatedQuestions?.length ?? 0),
                      }).map((_, i) => (
                        <div
                          key={`skeleton-${i}`}
                          className="rounded-xl border-2 border-blue-200 bg-blue-100/60 p-4 space-y-3 animate-pulse"
                        >
                          <div className="h-4 w-1/3 rounded bg-blue-300" />
                          <div className="space-y-2">
                            <div className="h-3 w-full rounded bg-blue-200" />
                            <div className="h-3 w-4/5 rounded bg-blue-200" />
                          </div>
                          <div className="flex gap-2">
                            <div className="h-9 flex-1 rounded-lg bg-blue-200" />
                            <div className="h-9 flex-1 rounded-lg bg-blue-200" />
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
                        className="w-full rounded-xl bg-blue-600 py-3 text-base font-semibold text-white shadow-sm transition hover:bg-blue-700 disabled:opacity-50 disabled:pointer-events-none"
                      >
                        {isAnalyzing ? "Analyzing…" : "Analyze Answers"}
                      </button>
                      {analyzeError && (
                        <div className="rounded-xl border-2 border-red-200 bg-red-50 p-4 text-base text-red-700">
                          {analyzeError}
                        </div>
                      )}
                    </div>
                  )}

                  {(!generatedQuestions || generatedQuestions.length === 0) && !isGenerating && (
                    <div className="rounded-xl border-2 border-blue-200 bg-blue-50/50 p-4 text-base text-gray-900">
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
              <h2 className="flex flex-wrap items-center gap-2 text-xl font-bold text-gray-900">
                <span className="flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-blue-100 shadow-sm ring-2 ring-blue-200/60">
                  <Image
                    src="/branding/neuroplan-glasses.png"
                    alt=""
                    width={40}
                    height={40}
                    className="object-contain object-center"
                  />
                </span>
                Insights
              </h2>

              {/* AI Recommendation: Learning Mode */}
              {analysis && (() => {
                const recommendedMode: "autopilot" | "coach" =
                  aiRecommendedMode ?? (analysis.recommended_mode === "Autopilot" ? "autopilot" : "coach");
                const callout = getModeCallout(mode, recommendedMode);
                const isMatch = recommendedMode === mode;
                return (
                  <div className={`${CARD} border-blue-200 bg-blue-50/40`}>
                    <h3 className="text-lg font-bold text-gray-900">
                      AI Recommendation: Learning Mode
                    </h3>
                    <p className="mt-1 text-sm text-gray-600">
                      Guidance only. Your selected mode (Setup or below) is used for your plan.
                    </p>
                    <div
                      className={`mt-4 rounded-xl border-2 p-4 text-base ${
                        callout.variant === "success"
                          ? "border-emerald-200 bg-emerald-50/80 text-emerald-900"
                          : "border-blue-200 bg-blue-100/60 text-gray-900"
                      }`}
                    >
                      <p className="font-semibold">{callout.title}</p>
                      {callout.body && (
                        <p className="mt-2 text-sm opacity-90">{callout.body}</p>
                      )}
                    </div>
                    {(modeReasoning || analysis.mode_reasoning || "").trim() ? (
                      <div className="mt-3 text-sm text-gray-700">
                        <MD>{modeReasoning || analysis.mode_reasoning || ""}</MD>
                      </div>
                    ) : null}
                    <div className="mt-4 flex flex-wrap gap-2">
                      {!isMatch && (
                        <button
                          type="button"
                          onClick={() => setMode(recommendedMode)}
                          className="rounded-xl bg-blue-600 px-4 py-2.5 text-base font-semibold text-white shadow-sm transition hover:bg-blue-700"
                        >
                          Accept Recommendation
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => {}}
                        className="rounded-xl border-2 border-blue-200 bg-white px-4 py-2.5 text-base font-semibold text-blue-700 transition hover:bg-blue-50"
                      >
                        {isMatch ? "Keeping current mode" : "Keep My Current Mode"}
                      </button>
                    </div>
                  </div>
                );
              })()}

              <div className="grid gap-4 sm:grid-cols-2">
                <div className={CARD}>
                  <h3 className="text-base font-bold text-gray-900">
                    Mastery %
                  </h3>
                  {analysis ? (
                    <p className="mt-2 text-2xl font-bold text-gray-900">
                      {analysis.mastery_percent}%
                    </p>
                  ) : (
                    <p className="mt-2 text-base text-gray-600">
                      Complete the diagnostic and analyze answers to see
                      mastery.
                    </p>
                  )}
                </div>
                <div className={CARD}>
                  <h3 className="text-base font-bold text-gray-900">
                    Weaknesses
                  </h3>
                  {analysis && analysis.weaknesses.length > 0 ? (
                    <ul className="mt-2 space-y-2">
                      {analysis.weaknesses.map((w, i) => (
                        <li
                          key={i}
                          className="flex flex-wrap items-start gap-2 text-base"
                        >
                          <span
                            className={`shrink-0 rounded-full px-2.5 py-0.5 text-sm font-medium ${
                              w.severity === "high"
                                ? "bg-red-100 text-red-800"
                                : w.severity === "medium"
                                  ? "bg-amber-100 text-amber-800"
                                  : "bg-blue-200 text-blue-700"
                            }`}
                          >
                            {w.severity}
                          </span>
                          <div className="font-semibold text-gray-900 shrink-0 min-w-0">
                            <MD>{w.concept_tag ?? ""}</MD>
                          </div>
                          {w.description && (
                            <div className="text-gray-700 min-w-0 flex-1">
                              <MD>{`— ${w.description}`}</MD>
                            </div>
                          )}
                        </li>
                      ))}
                    </ul>
                  ) : analysis ? (
                    <p className="mt-2 text-base text-gray-600">
                      No weaknesses identified.
                    </p>
                  ) : (
                    <p className="mt-2 text-base text-gray-600">
                      Topics to focus on will appear here after analysis.
                    </p>
                  )}
                </div>
              </div>

              <div className={CARD}>
                <h3 className="text-base font-bold text-gray-900">
                  Predicted Score
                </h3>
                <div className="mt-3 flex flex-wrap gap-4">
                  <div className="rounded-xl bg-blue-100/80 px-4 py-3">
                    <span className="text-sm font-medium text-gray-600">Today</span>
                    <p className="text-xl font-bold text-gray-900">
                      {analysis?.predicted_score?.today != null
                        ? `${analysis.predicted_score.today}%`
                        : "— %"}
                    </p>
                  </div>
                  <div className="rounded-xl bg-blue-100/80 px-4 py-3">
                    <span className="text-sm font-medium text-gray-600">After 7 days</span>
                    <p className="text-xl font-bold text-gray-900">
                      {analysis?.predicted_score?.after_7_days != null
                        ? `${analysis.predicted_score.after_7_days}%`
                        : "— %"}
                    </p>
                  </div>
                  <div className="rounded-xl bg-blue-100/80 px-4 py-3">
                    <span className="text-sm font-medium text-gray-600">After fixing top 3</span>
                    <p className="text-xl font-bold text-gray-900">
                      {analysis?.predicted_score?.after_fixing_top3 != null
                        ? `${analysis.predicted_score.after_fixing_top3}%`
                        : "— %"}
                    </p>
                  </div>
                </div>
              </div>

              {analysis?.strong_learner != null && (
                <div className={CARD}>
                  <h3 className="text-base font-bold text-gray-900">
                    Level-Up Tools
                  </h3>
                  <p className="mt-1 text-sm text-gray-600">
                    Optional challenges that push you further once your basics are solid.
                  </p>
                  <p className="mt-2 text-base text-gray-900">
                    {analysis.strong_learner
                      ? "Your profile suggests strong learning habits; Coach mode can help you stay in control while still getting guidance."
                      : "Focus on core gaps first; Autopilot can help structure your practice until foundations are solid."}
                  </p>
                </div>
              )}

              {analysis?.careless_patterns != null &&
                analysis.careless_patterns.length > 0 && (
                  <div className={CARD}>
                    <h3 className="text-base font-bold text-gray-900">
                      Careless patterns
                    </h3>
                    <ul className="mt-2 list-inside list-disc space-y-1 text-base text-gray-900">
                      {analysis.careless_patterns.map((p, i) => (
                        <li key={i}><MD>{p}</MD></li>
                      ))}
                    </ul>
                  </div>
                )}

              {(!analysis || analysis.strong_learner == null) && (
                <div className={CARD}>
                  <h3 className="text-base font-bold text-gray-900">
                    Level-Up Tools
                  </h3>
                  <p className="mt-1 text-sm text-gray-600">
                    Optional challenges that push you further once your basics are solid.
                  </p>
                  <p className="mt-2 text-base text-gray-600">
                    {analysis
                      ? "Recommended tools and techniques will appear here when available."
                      : "Complete the diagnostic and analyze answers to see recommendations."}
                  </p>
                </div>
              )}

              {analysis && (
                <div className="flex flex-col gap-2">
                  <button
                    type="button"
                    onClick={generatePlan}
                    disabled={isGeneratingPlan || !currentSubject}
                    className="rounded-xl bg-blue-600 px-5 py-3 text-base font-semibold text-white shadow-sm transition hover:bg-blue-700 disabled:opacity-50 disabled:pointer-events-none"
                  >
                    {isGeneratingPlan ? "Generating…" : "Generate Study Plan"}
                  </button>
                  {planError && (
                    <p className="text-base text-red-600">{planError}</p>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Step 3: Plan — planner sheet layout */}
          {step === 3 && (() => {
            const planDays = plan?.days ?? [];
            const totalPlanHours = planDays.reduce((s: number, d: { hours?: number }) => s + (Number(d.hours) || 0), 0);
            const topicsList = analysis?.weaknesses?.length
              ? analysis.weaknesses.map((w) => w.concept_tag)
              : plan?.strategy_summary
                ? plan.strategy_summary
                    .split(/[.,;]\s+/)
                    .filter((s: string) => s.trim().length > 2)
                    .slice(0, 6)
                    .map((s: string) => s.trim())
                : [];
            const derivedTodos = planDays.length
              ? planDays.slice(0, 7).map((d: { day: number; focus?: string; method?: string }) =>
                  `Day ${d.day}: ${d.focus || "Study"}${d.method ? ` — ${d.method}` : ""}`
                )
              : [];
            const todayLabel = typeof window !== "undefined"
              ? new Date().toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
              : "Generated plan";

            return (
              <div className="rounded-2xl border-2 border-blue-200/80 bg-gradient-to-b from-blue-50/90 to-blue-100/50 p-5 shadow-lg shadow-blue-100/50 sm:p-6">
                {/* Header row — book mascot on soft background for transparent PNG */}
                <div className="mb-6 flex flex-wrap items-center justify-between gap-3 border-b-2 border-blue-200/70 pb-4">
                  <h2 className="flex flex-wrap items-center gap-2 text-2xl font-bold tracking-tight text-gray-900">
                    <span className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-blue-100 shadow-sm ring-2 ring-blue-200/60" aria-hidden>
                      <Image
                        src="/branding/neuroplan-book.png"
                        alt=""
                        width={44}
                        height={44}
                        className="object-contain object-center"
                      />
                    </span>
                    Study Planner
                  </h2>
                  <span className="rounded-full bg-blue-200/70 px-3 py-1.5 text-sm font-semibold text-gray-900">
                    {todayLabel}
                  </span>
                </div>
                <div className="mb-6 rounded-xl border-2 border-blue-200/70 bg-blue-100/80 px-5 py-4 text-base italic leading-relaxed text-gray-900">
                  &ldquo;Small steps, big progress.&rdquo;
                </div>

                <div className="mb-8 border-t-2 border-blue-200/60 pt-6" aria-hidden />

                {/* Main grid — stacked on mobile, 2 cols on lg */}
                <div className="grid grid-cols-1 gap-8 lg:grid-cols-2">
                  {/* LEFT column */}
                  <div className="space-y-6">
                    {/* Time Table (7-day) */}
                    <div className="rounded-2xl border-2 border-blue-200/80 bg-white p-5 shadow-md shadow-blue-100/30">
                      <h3 className="mb-5 text-lg font-bold text-gray-900">
                        <span className="mr-2" aria-hidden>🗓️</span>
                        Time Table (7-day)
                      </h3>
                      <div className="space-y-2">
                        {(plan?.days ?? [1, 2, 3, 4, 5, 6, 7].map((d: number) => ({ day: d, focus: "", hours: 0, method: "" }))).map(
                          (row: { day: number; focus?: string; hours?: number; method?: string }) => {
                            const hours = plan?.days ? Number(row.hours) || 0 : 0;
                            let loadLabel = "";
                            let loadBadgeClass = "";
                            if (plan?.days && row.hours != null) {
                              if (hours >= dailyHours) {
                                loadLabel = "Full load";
                                loadBadgeClass = "bg-amber-100 text-amber-800";
                              } else if (hours < dailyHours * 0.6) {
                                loadLabel = "Light day";
                                loadBadgeClass = "bg-sky-100 text-sky-800";
                              } else {
                                loadLabel = "Balanced";
                                loadBadgeClass = "bg-blue-200 text-blue-800";
                              }
                            }
                            return (
                              <div
                                key={row.day}
                                className="flex items-start gap-2 rounded-lg border border-blue-100 bg-blue-50/50 px-2 py-2 shadow-sm transition-shadow duration-200 hover:shadow-md"
                              >
                                <div className="flex shrink-0 flex-col items-center gap-0.5">
                                  <span className="flex h-8 w-8 items-center justify-center rounded-full bg-blue-200 text-xs font-bold text-blue-800">
                                    {row.day}
                                  </span>
                                  {plan?.days && row.hours != null && (
                                    <span className="text-xs font-semibold text-blue-700">
                                      {row.hours}h
                                    </span>
                                  )}
                                </div>
                                <div className="min-w-0 flex-1 space-y-1">
                                  <div className="text-base font-bold leading-snug text-gray-900">
                                    <MD>{row.focus || "—"}</MD>
                                  </div>
                                  {row.method && (
                                    <div className="text-sm leading-relaxed text-gray-600">
                                      <MD>{row.method}</MD>
                                    </div>
                                  )}
                                  {loadLabel && (
                                    <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${loadBadgeClass}`}>
                                      {loadLabel}
                                    </span>
                                  )}
                                </div>
                              </div>
                            );
                          }
                        )}
                      </div>
                    </div>

                    {/* Topics to Grasp */}
                    <div className="rounded-2xl border-2 border-blue-200/80 bg-white p-5 shadow-md shadow-blue-100/30">
                      <h3 className="mb-5 text-lg font-bold text-gray-900">
                        <span className="mr-2" aria-hidden>✅</span>
                        Topics to Grasp
                      </h3>
                      {topicsList.length > 0 ? (
                        <ul className="space-y-2.5">
                          {topicsList.map((topic: string, i: number) => (
                            <li key={i} className="flex items-center gap-3">
                              <input
                                type="checkbox"
                                checked={planTopicsChecked[i] ?? false}
                                onChange={() =>
                                  setPlanTopicsChecked((prev) => ({
                                    ...prev,
                                    [i]: !(prev[i] ?? false),
                                  }))
                                }
                                className="h-5 w-5 rounded border-blue-300 text-blue-600 focus:ring-blue-300"
                              />
                              <div className="text-base text-gray-900 min-w-0 flex-1"><MD>{topic}</MD></div>
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <p className="text-base leading-relaxed text-gray-600">
                          Generate a plan to see topics here, or complete the diagnostic for weakness-based list.
                        </p>
                      )}
                    </div>
                  </div>

                  {/* RIGHT column — divider above on mobile when stacked */}
                  <div className="space-y-6 border-t-2 border-blue-200/60 pt-6 lg:border-t-0 lg:pt-0">
                    {/* To-do List */}
                    <div className="rounded-2xl border-2 border-blue-200/80 bg-white p-5 shadow-md shadow-blue-100/30">
                      <h3 className="mb-5 text-lg font-bold text-gray-900">
                        <span className="mr-2" aria-hidden>✅</span>
                        To-do List
                      </h3>
                      {derivedTodos.length > 0 ? (
                        <ul className="space-y-2.5">
                          {derivedTodos.map((todo: string, i: number) => (
                            <li key={i} className="flex items-start gap-3">
                              <input
                                type="checkbox"
                                checked={planTodoChecked[i] ?? false}
                                onChange={() =>
                                  setPlanTodoChecked((prev) => ({
                                    ...prev,
                                    [i]: !(prev[i] ?? false),
                                  }))
                                }
                                className="mt-0.5 h-5 w-5 shrink-0 rounded border-blue-300 text-blue-600 focus:ring-blue-300"
                              />
                              <div className={`text-base leading-relaxed min-w-0 flex-1 ${planTodoChecked[i] ? "text-gray-400 line-through" : "text-gray-900"}`}>
                                <MD>{todo}</MD>
                              </div>
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <p className="text-base leading-relaxed text-gray-600">
                          Generate a plan to see daily to-dos here.
                        </p>
                      )}
                    </div>

                    {/* Notes */}
                    <div className="rounded-2xl border-2 border-blue-200/80 bg-white p-5 shadow-md shadow-blue-100/30">
                      <h3 className="mb-5 text-lg font-bold text-gray-900">
                        <span className="mr-2" aria-hidden>📝</span>
                        Notes
                      </h3>
                      <textarea
                        value={planNotes}
                        onChange={(e) => setPlanNotes(e.target.value)}
                        placeholder="Jot down reminders, resources, or goals..."
                        rows={4}
                        className="w-full rounded-xl border-2 border-blue-200 bg-blue-50/50 px-4 py-3 text-base leading-relaxed text-gray-900 placeholder-gray-400 outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-200"
                      />
                    </div>

                    {/* Hours of Study */}
                    <div className="rounded-2xl border-2 border-blue-200/80 bg-white p-5 shadow-md shadow-blue-100/30">
                      <h3 className="mb-5 text-lg font-bold text-gray-900">
                        <span className="mr-2" aria-hidden>⏳</span>
                        Hours of Study
                      </h3>
                      <div className="flex flex-wrap gap-5">
                        <div className="rounded-xl bg-blue-100/80 px-5 py-3.5">
                          <span className="block text-sm font-semibold text-gray-600">Daily cap</span>
                          <p className="mt-1 text-xl font-bold text-gray-900">{dailyHours}h</p>
                        </div>
                        <div className="rounded-xl bg-blue-200/80 px-5 py-3.5">
                          <span className="block text-sm font-semibold text-gray-600">Plan total</span>
                          <p className="mt-1 text-xl font-bold text-gray-900">{totalPlanHours}h</p>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Why this plan? — compact card with show more */}
                {(plan?.strategy_summary || plan?.rationale) && (() => {
                  const toBullets = (text: string) =>
                    text
                      .split(/(?<=[.!?])\s+/)
                      .map((s) => s.trim())
                      .filter(Boolean);
                  const strategyBullets = plan.strategy_summary ? toBullets(plan.strategy_summary) : [];
                  const rationaleBullets = plan.rationale ? toBullets(plan.rationale) : [];
                  const needsToggle =
                    (plan.strategy_summary?.length ?? 0) + (plan.rationale?.length ?? 0) > 280;
                  return (
                    <div className="mt-8 border-t-2 border-blue-200/60 pt-6">
                      <div className="rounded-xl border-2 border-blue-200/80 bg-white p-5 shadow-sm">
                        <h3 className="text-base font-bold text-gray-900">
                          Why this plan?
                        </h3>
                        <div
                          className={`mt-3 text-base leading-relaxed text-gray-900 ${!planWhyExpanded ? "line-clamp-6" : ""}`}
                        >
                          {plan.strategy_summary && (
                            <div className={rationaleBullets.length > 0 ? "mb-2" : ""}>
                              {strategyBullets.length > 1 ? (
                                <ul className="list-inside list-disc space-y-0.5">
                                  {strategyBullets.map((s, i) => (
                                    <li key={i}><MD>{s}</MD></li>
                                  ))}
                                </ul>
                              ) : (
                                <MD>{plan.strategy_summary}</MD>
                              )}
                            </div>
                          )}
                          {plan.rationale && (
                            <div>
                              {rationaleBullets.length > 1 ? (
                                <ul className="list-inside list-disc space-y-0.5">
                                  {rationaleBullets.map((s, i) => (
                                    <li key={i}><MD>{s}</MD></li>
                                  ))}
                                </ul>
                              ) : (
                                <MD>{plan.rationale}</MD>
                              )}
                            </div>
                          )}
                        </div>
                        {needsToggle && (
                          <button
                            type="button"
                            onClick={() => setPlanWhyExpanded((e) => !e)}
                            className="mt-2 text-sm font-semibold text-gray-600 hover:text-gray-900 focus:outline-none focus:underline"
                          >
                            {planWhyExpanded ? "Show less" : "Show more"}
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })()}

                <div className="mt-8 border-t-2 border-blue-200/60 pt-6">
                  <button
                    type="button"
                    onClick={async () => {
                      const planDays = plan?.daysFull ?? plan?.days ?? [];
                      if (planDays.length === 0) return;
                      try {
                        const res = await fetch("/api/export-ics", {
                          method: "POST",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({ planDays }),
                        });
                        if (!res.ok) throw new Error("Export failed");
                        const blob = await res.blob();
                        const url = URL.createObjectURL(blob);
                        const a = document.createElement("a");
                        a.href = url;
                        a.download = "neuroplan.ics";
                        a.click();
                        URL.revokeObjectURL(url);
                      } catch (e) {
                        console.error("ICS export failed:", e);
                      }
                    }}
                    disabled={!plan || ((plan.days?.length ?? 0) === 0 && (plan.daysFull?.length ?? 0) === 0)}
                    className="w-full rounded-xl border-2 border-blue-200 bg-blue-100/50 py-3.5 text-base font-medium text-blue-800 transition hover:bg-blue-200/60 focus:outline-none focus:ring-2 focus:ring-blue-300 disabled:cursor-not-allowed disabled:opacity-50 disabled:bg-blue-100/50 disabled:text-gray-500"
                  >
                    Download .ics
                  </button>
                </div>
              </div>
            );
          })()}

          {/* Step navigation */}
          <div className="mt-6 flex justify-between gap-3 border-t-2 border-blue-200 pt-5">
            <button
              type="button"
              onClick={goBack}
              disabled={step === 0}
              className="rounded-xl border-2 border-blue-200 bg-white px-5 py-2.5 text-base font-semibold text-gray-900 transition hover:bg-blue-50 disabled:opacity-50 disabled:pointer-events-none"
            >
              Back
            </button>
            <button
              type="button"
              onClick={goNext}
              disabled={step === 3}
              className="rounded-xl bg-blue-600 px-5 py-2.5 text-base font-semibold text-white shadow-sm transition hover:bg-blue-700 disabled:opacity-50 disabled:pointer-events-none"
            >
              Next
            </button>
          </div>
        </div>
      </div>
    </main>
  );
}