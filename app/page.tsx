"use client";

import { useState } from "react";

type Difficulty = "Easy" | "Medium" | "Hard";
type Mode = "autopilot" | "coach";

export default function StudyPlannerPage() {
  const [subjectName, setSubjectName] = useState("");
  const [examDate, setExamDate] = useState("");
  const [difficulty, setDifficulty] = useState<Difficulty>("Medium");
  const [dailyHours, setDailyHours] = useState<number>(2);
  const [mode, setMode] = useState<Mode>("autopilot");

  return (
    <main className="min-h-screen bg-stone-50 text-stone-900 flex flex-col items-center justify-center p-6">
      <div className="w-full max-w-md space-y-8">
        <header className="text-center">
          <h1 className="text-2xl font-semibold tracking-tight text-stone-800">
            AI Study Planner Engine
          </h1>
          <p className="mt-1.5 text-sm text-stone-500">
            Configure your study plan and start your diagnostic
          </p>
        </header>

        <form
          className="space-y-6 rounded-2xl border border-stone-200 bg-white p-6 shadow-sm"
          onSubmit={(e) => e.preventDefault()}
        >
          {/* Subject Name */}
          <div>
            <label
              htmlFor="subject"
              className="block text-sm font-medium text-stone-700"
            >
              Subject Name
            </label>
            <input
              id="subject"
              type="text"
              value={subjectName}
              onChange={(e) => setSubjectName(e.target.value)}
              placeholder="e.g. Linear Algebra"
              className="mt-1.5 w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm text-stone-900 placeholder-stone-400 outline-none transition focus:border-stone-500 focus:ring-1 focus:ring-stone-400"
            />
          </div>

          {/* Exam Date */}
          <div>
            <label
              htmlFor="exam-date"
              className="block text-sm font-medium text-stone-700"
            >
              Exam Date
            </label>
            <input
              id="exam-date"
              type="date"
              value={examDate}
              onChange={(e) => setExamDate(e.target.value)}
              className="mt-1.5 w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm text-stone-900 outline-none transition focus:border-stone-500 focus:ring-1 focus:ring-stone-400"
            />
          </div>

          {/* Difficulty */}
          <div>
            <label
              htmlFor="difficulty"
              className="block text-sm font-medium text-stone-700"
            >
              Difficulty
            </label>
            <select
              id="difficulty"
              value={difficulty}
              onChange={(e) => setDifficulty(e.target.value as Difficulty)}
              className="mt-1.5 w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm text-stone-900 outline-none transition focus:border-stone-500 focus:ring-1 focus:ring-stone-400"
            >
              <option value="Easy">Easy</option>
              <option value="Medium">Medium</option>
              <option value="Hard">Hard</option>
            </select>
          </div>

          {/* Daily Study Hours */}
          <div>
            <label
              htmlFor="daily-hours"
              className="block text-sm font-medium text-stone-700"
            >
              Daily Available Study Hours
            </label>
            <input
              id="daily-hours"
              type="number"
              min={0.5}
              max={24}
              step={0.5}
              value={dailyHours}
              onChange={(e) =>
                setDailyHours(Math.max(0, Math.min(24, Number(e.target.value) || 0)))
              }
              className="mt-1.5 w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm text-stone-900 outline-none transition focus:border-stone-500 focus:ring-1 focus:ring-stone-400"
            />
          </div>

          {/* Mode Toggle */}
          <div>
            <span className="block text-sm font-medium text-stone-700">
              Mode
            </span>
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

          <button
            type="submit"
            className="w-full rounded-lg bg-stone-800 py-2.5 text-sm font-medium text-white transition hover:bg-stone-700 focus:outline-none focus:ring-2 focus:ring-stone-500 focus:ring-offset-2"
          >
            Start Diagnostic
          </button>
        </form>
      </div>
    </main>
  );
}
