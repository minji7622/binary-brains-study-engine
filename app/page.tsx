"use client";

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

type DiagnosticQuestion = {
  answer: string;
  skip: boolean;
  noIdea: boolean;
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

export default function StudyPlannerPage() {
  const [step, setStep] = useState<StepIndex>(0);

  // Setup
  const [subjects, setSubjects] = useState<Subject[]>([
    { id: generateId(), name: "", examDate: "", difficulty: "Medium" },
  ]);
  const [dailyHours, setDailyHours] = useState<number>(2);
  const [mode, setMode] = useState<Mode>("autopilot");
  const [projectDeadlines, setProjectDeadlines] = useState<ProjectDeadline[]>([]);

  // Diagnostic
  const [selectedSubjectId, setSelectedSubjectId] = useState<string | null>(null);
  const [diagnosticQuestions, setDiagnosticQuestions] = useState<
    DiagnosticQuestion[]
  >(Array.from({ length: 7 }, () => ({ answer: "", skip: false, noIdea: false })));

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

  const setDiagnosticQuestion = (index: number, patch: Partial<DiagnosticQuestion>) => {
    setDiagnosticQuestions((prev) =>
      prev.map((q, i) => (i === index ? { ...q, ...patch } : q))
    );
  };

  const goNext = () => {
    if (step < 3) setStep((step + 1) as StepIndex);
  };

  const goBack = () => {
    if (step > 0) setStep((step - 1) as StepIndex);
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
                  onChange={(e) =>
                    setSelectedSubjectId(e.target.value || null)
                  }
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
                  <p className="text-sm text-stone-600">
                    Answer or skip each question for{" "}
                    <strong>{selectedSubjectDisplay}</strong>.
                  </p>
                  {diagnosticQuestions.map((q, i) => (
                    <div
                      key={i}
                      className="rounded-lg border border-stone-200 bg-stone-50/50 p-3 space-y-2"
                    >
                      <label className="text-sm font-medium text-stone-700">
                        Question {i + 1}
                      </label>
                      <input
                        type="text"
                        value={q.answer}
                        onChange={(e) =>
                          setDiagnosticQuestion(i, { answer: e.target.value })
                        }
                        placeholder="Your answer..."
                        className={`w-full ${INPUT}`}
                      />
                      <div className="flex flex-wrap gap-4">
                        <label className="flex items-center gap-2 text-sm text-stone-600">
                          <input
                            type="checkbox"
                            checked={q.skip}
                            onChange={(e) =>
                              setDiagnosticQuestion(i, { skip: e.target.checked })
                            }
                            className="rounded border-stone-300"
                          />
                          Skip
                        </label>
                        <label className="flex items-center gap-2 text-sm text-stone-600">
                          <input
                            type="checkbox"
                            checked={q.noIdea}
                            onChange={(e) =>
                              setDiagnosticQuestion(i, {
                                noIdea: e.target.checked,
                              })
                            }
                            className="rounded border-stone-300"
                          />
                          No idea
                        </label>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Step 2: Insights */}
          {step === 2 && (
            <div className="space-y-6">
              <h2 className="text-lg font-medium text-stone-800">Insights</h2>

              <div className="grid gap-4 sm:grid-cols-2">
                <div className={CARD}>
                  <h3 className="text-sm font-medium text-stone-600">
                    Weaknesses
                  </h3>
                  <p className="mt-2 text-sm text-stone-500">
                    Placeholder: topics to focus on will appear here.
                  </p>
                </div>
                <div className={CARD}>
                  <h3 className="text-sm font-medium text-stone-600">
                    Mastery %
                  </h3>
                  <p className="mt-2 text-sm text-stone-500">
                    Placeholder: overall mastery percentage.
                  </p>
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
                      — %
                    </p>
                  </div>
                  <div className="rounded-lg bg-stone-100 px-3 py-2">
                    <span className="text-xs text-stone-500">After 7 days</span>
                    <p className="text-lg font-semibold text-stone-800">
                      — %
                    </p>
                  </div>
                </div>
              </div>

              <div className={CARD}>
                <h3 className="text-sm font-medium text-stone-600">
                  Strong Learner Tools
                </h3>
                <p className="mt-2 text-sm text-stone-500">
                  Placeholder: recommended tools and techniques will appear
                  here.
                </p>
              </div>
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
