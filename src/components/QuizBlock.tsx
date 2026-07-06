import { useEffect, useMemo, useState } from "react";
import type { QuizAttempt } from "../lib/api";

type QuizType = "single_choice" | "multiple_choice" | "text";

interface QuizOption {
  id: string;
  text: string;
}

interface QuizData {
  id: string;
  type: QuizType;
  question: string;
  options: QuizOption[];
  correctValues: string[];
  explanation: string;
  points: number;
}

interface QuizResult {
  isCorrect: boolean;
  score: number;
  maxScore: number;
  answerLabel: string;
  explanation: string;
}

interface QuizBlockProps {
  source: string;
  attempts: QuizAttempt[];
  onSaveAttempt: (
    quizId: string,
    quizType: string,
    answerJson: string,
    isCorrect: boolean,
    score: number,
    maxScore: number,
    explanation: string,
  ) => Promise<QuizAttempt>;
}

export function QuizBlock({
  source,
  attempts,
  onSaveAttempt,
}: QuizBlockProps) {
  const quizzes = useMemo(() => parseQuizSet(source), [source]);

  if (quizzes.length === 0) {
    return (
      <pre className="my-4 max-w-full overflow-x-hidden whitespace-pre-wrap break-words rounded-2xl border border-[color:var(--border)] bg-[color:var(--panel-soft)] p-4 text-xs leading-relaxed">
        <code>{source}</code>
      </pre>
    );
  }

  if (quizzes.length > 1) {
    return (
      <div className="my-5 space-y-4">
        {quizzes.map((quiz) => (
          <QuizCard
            key={quiz.id}
            quiz={quiz}
            attempts={attempts}
            onSaveAttempt={onSaveAttempt}
          />
        ))}
      </div>
    );
  }

  return (
    <QuizCard
      quiz={quizzes[0]}
      attempts={attempts}
      onSaveAttempt={onSaveAttempt}
    />
  );
}

function QuizCard({
  quiz,
  attempts,
  onSaveAttempt,
}: {
  quiz: QuizData;
  attempts: QuizAttempt[];
  onSaveAttempt: QuizBlockProps["onSaveAttempt"];
}) {
  const attempt = useMemo(
    () => attempts.find((item) => item.quiz_id === quiz.id),
    [attempts, quiz],
  );
  const savedAnswer = useMemo(() => parseAttemptAnswer(attempt?.answer_json), [attempt?.answer_json]);
  const [singleValue, setSingleValue] = useState(() => firstAnswerValue(savedAnswer));
  const [multiValues, setMultiValues] = useState<string[]>(() => arrayAnswerValue(savedAnswer));
  const [textValue, setTextValue] = useState(() => firstAnswerValue(savedAnswer));
  const [localResult, setLocalResult] = useState<QuizResult | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!attempt) return;
    setSingleValue(firstAnswerValue(savedAnswer));
    setMultiValues(arrayAnswerValue(savedAnswer));
    setTextValue(firstAnswerValue(savedAnswer));
  }, [attempt, savedAnswer]);

  const result = attempt
    ? attemptToResult(attempt, quiz)
    : localResult;
  const answered = Boolean(result);
  const currentAnswer = quiz.type === "multiple_choice" ? multiValues : quiz.type === "text" ? textValue : singleValue;
  const canSubmit =
    !answered &&
    !saving &&
    (Array.isArray(currentAnswer) ? currentAnswer.length > 0 : currentAnswer.trim().length > 0);

  const toggleMultiValue = (id: string) => {
    setMultiValues((current) =>
      current.includes(id) ? current.filter((item) => item !== id) : [...current, id],
    );
  };

  const submit = async () => {
    if (!canSubmit) return;
    setSaving(true);
    setError("");
    const answer = quiz.type === "multiple_choice" ? multiValues : quiz.type === "text" ? textValue : singleValue;
    const nextResult = checkAnswer(quiz, answer);
    const answerJson = JSON.stringify(answer);
    setLocalResult(nextResult);
    try {
      await onSaveAttempt(
        quiz.id,
        quiz.type,
        answerJson,
        nextResult.isCorrect,
        nextResult.score,
        nextResult.maxScore,
        nextResult.explanation,
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="my-5 overflow-hidden rounded-lg border border-[color:var(--border)] bg-[color:var(--panel)] text-[14px] leading-6 shadow-[0_1px_3px_rgba(0,0,0,0.08)]">
      <div className="border-b border-[color:var(--border)] bg-[color:var(--panel-soft)] px-4 py-2">
        <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[color:var(--muted)]">
          Quiz
        </div>
        <div className="mt-1 font-medium text-[color:var(--text)]">{quiz.question}</div>
      </div>

      <div className="space-y-3 px-4 py-4">
        {quiz.type !== "text" && (
          <div className="space-y-2">
            {quiz.options.map((option) => {
              const checked =
                quiz.type === "multiple_choice"
                  ? multiValues.includes(option.id)
                  : singleValue === option.id;
              const inputType = quiz.type === "multiple_choice" ? "checkbox" : "radio";
              return (
                <label
                  key={option.id}
                  className={`flex min-w-0 cursor-pointer items-start gap-3 rounded-lg border px-3 py-2 transition-colors ${
                    checked
                      ? "border-[color:var(--accent)] bg-[color:var(--selected)]"
                      : "border-[color:var(--border)] bg-[color:var(--app-bg)] hover:bg-[color:var(--panel-soft)]"
                  } ${answered ? "cursor-default opacity-85" : ""}`}
                >
                  <input
                    type={inputType}
                    name={`quiz-${quiz.id}`}
                    value={option.id}
                    checked={checked}
                    disabled={answered}
                    onChange={() =>
                      quiz.type === "multiple_choice" ? toggleMultiValue(option.id) : setSingleValue(option.id)
                    }
                    className="mt-1 h-4 w-4 shrink-0 accent-[color:var(--accent)]"
                  />
                  <span className="min-w-0 break-words">{option.text}</span>
                </label>
              );
            })}
          </div>
        )}

        {quiz.type === "text" && (
          <input
            type="text"
            value={textValue}
            disabled={answered}
            onChange={(event) => setTextValue(event.target.value)}
            className="h-10 w-full rounded-lg border border-[color:var(--border)] bg-[color:var(--app-bg)] px-3 text-[14px] text-[color:var(--text)] outline-none transition-shadow focus:shadow-[0_0_0_3px_rgba(0,0,0,0.06)] disabled:opacity-75"
            placeholder="Ответ"
          />
        )}

        {!answered && (
          <button
            type="button"
            disabled={!canSubmit}
            onClick={() => void submit()}
            className="inline-flex h-9 items-center justify-center rounded-lg bg-[color:var(--button)] px-3 text-sm font-medium text-[color:var(--button-text)] transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-35"
          >
            {saving ? "Сохраняю" : "Проверить"}
          </button>
        )}

        {result && (
          <div
            className={`rounded-lg border px-3 py-2 ${
              result.isCorrect
                ? "border-emerald-500/35 bg-emerald-500/10"
                : "border-rose-500/35 bg-rose-500/10"
            }`}
          >
            <div className="font-semibold">
              {result.isCorrect ? "Верно" : "Неверно"} · {formatScore(result.score)} /{" "}
              {formatScore(result.maxScore)}
            </div>
            <div className="mt-1 text-[color:var(--muted)]">
              Правильный ответ: <span className="text-[color:var(--text)]">{result.answerLabel}</span>
            </div>
            {result.explanation && <div className="mt-2">{result.explanation}</div>}
          </div>
        )}

        {error && <div className="text-xs text-red-600">{error}</div>}
      </div>
    </section>
  );
}

function parseQuizSet(source: string): QuizData[] {
  let raw: unknown;
  try {
    raw = JSON.parse(source);
  } catch {
    return [];
  }
  if (Array.isArray(raw)) {
    return raw
      .map((item, index) => parseQuizObject(item, `${source}:${index}`))
      .filter((item): item is QuizData => Boolean(item));
  }
  if (!raw || typeof raw !== "object") return [];
  const object = raw as Record<string, unknown>;
  if (Array.isArray(object.questions)) {
    return object.questions
      .map((item, index) => parseQuizObject(item, `${source}:question:${index}`))
      .filter((item): item is QuizData => Boolean(item));
  }
  const quiz = parseQuizObject(object, source);
  return quiz ? [quiz] : [];
}

function parseQuizObject(raw: unknown, fallbackSource: string): QuizData | null {
  if (!raw || typeof raw !== "object") return null;
  const object = raw as Record<string, unknown>;
  const question = stringField(object, ["question", "prompt", "text"]);
  const id = stringField(object, ["id", "quiz_id", "quizId"]) || stableQuizId(fallbackSource);
  const options = normalizeOptions(object.options);
  const correctValues = normalizeCorrectValues(object);
  const type = normalizeQuizType(stringField(object, ["type", "kind"])) ?? inferQuizType(options, correctValues);
  const explanation = stringField(object, ["explanation", "feedback", "reason"]) || "";
  const points = positiveNumber(object.points) ?? positiveNumber(object.score) ?? 1;

  if (!type || !question || correctValues.length === 0) return null;
  if (type !== "text" && options.length < 2) return null;
  return { id, type, question, options, correctValues, explanation, points };
}

function inferQuizType(options: QuizOption[], correctValues: string[]): QuizType | null {
  if (options.length >= 2) {
    return correctValues.length > 1 ? "multiple_choice" : "single_choice";
  }
  return correctValues.length > 0 ? "text" : null;
}

function normalizeQuizType(value: string): QuizType | null {
  const normalized = value.trim().toLowerCase().replace(/[-\s]/g, "_");
  if (["single", "single_choice", "choice", "radio"].includes(normalized)) return "single_choice";
  if (["multiple", "multiple_choice", "multi", "checkbox"].includes(normalized)) {
    return "multiple_choice";
  }
  if (["text", "text_answer", "short_answer", "fill_blank", "fill_in_blank"].includes(normalized)) {
    return "text";
  }
  return null;
}

function normalizeOptions(value: unknown): QuizOption[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item, index) => {
      if (typeof item === "string" || typeof item === "number") {
        return { id: String(index + 1), text: String(item) };
      }
      if (!item || typeof item !== "object") return null;
      const object = item as Record<string, unknown>;
      const text = stringField(object, ["text", "label", "value", "title"]);
      if (!text) return null;
      return {
        id: stringField(object, ["id", "key"]) || String(index + 1),
        text,
      };
    })
    .filter((item): item is QuizOption => Boolean(item));
}

function normalizeCorrectValues(object: Record<string, unknown>) {
  const candidates = [
    object.answer,
    object.answers,
    object.correct,
    object.correct_answer,
    object.correctAnswer,
    object.correct_answers,
    object.correctAnswers,
    object.accepted_answers,
    object.acceptedAnswers,
  ];
  for (const candidate of candidates) {
    const values = valueList(candidate);
    if (values.length > 0) return values;
  }
  return [];
}

function checkAnswer(quiz: QuizData, answer: string | string[]): QuizResult {
  const maxScore = quiz.points;
  const correctIds = correctOptionIds(quiz);
  let isCorrect = false;

  if (quiz.type === "text") {
    const normalizedAnswer = normalizeTextAnswer(String(answer));
    isCorrect = quiz.correctValues.some((value) => normalizeTextAnswer(value) === normalizedAnswer);
  } else if (quiz.type === "multiple_choice") {
    const selected = new Set(Array.isArray(answer) ? answer : []);
    isCorrect = selected.size === correctIds.length && correctIds.every((id) => selected.has(id));
  } else {
    isCorrect = correctIds.includes(String(answer));
  }

  return {
    isCorrect,
    score: isCorrect ? maxScore : 0,
    maxScore,
    answerLabel: correctAnswerLabel(quiz),
    explanation: quiz.explanation,
  };
}

function attemptToResult(attempt: QuizAttempt, quiz: QuizData): QuizResult {
  return {
    isCorrect: attempt.is_correct,
    score: attempt.score,
    maxScore: attempt.max_score,
    answerLabel: correctAnswerLabel(quiz),
    explanation: attempt.explanation || quiz.explanation,
  };
}

function correctOptionIds(quiz: QuizData) {
  return quiz.correctValues.map((value) => optionIdForValue(quiz.options, value) ?? value);
}

function correctAnswerLabel(quiz: QuizData) {
  if (quiz.type === "text") return quiz.correctValues.join(", ");
  const labels = correctOptionIds(quiz).map((id) => quiz.options.find((option) => option.id === id)?.text ?? id);
  return labels.join(", ");
}

function optionIdForValue(options: QuizOption[], value: string) {
  const normalized = normalizeTextAnswer(value);
  return options.find((option) => option.id === value || normalizeTextAnswer(option.text) === normalized)?.id;
}

function stringField(object: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = object[key];
    if (typeof value === "string" || typeof value === "number") {
      const text = String(value).trim();
      if (text) return text;
    }
  }
  return "";
}

function valueList(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value
      .flatMap((item) => valueList(item))
      .map((item) => item.trim())
      .filter(Boolean);
  }
  if (typeof value === "string" || typeof value === "number") {
    const text = String(value).trim();
    return text ? [text] : [];
  }
  if (value && typeof value === "object") {
    return valueList((value as Record<string, unknown>).id ?? (value as Record<string, unknown>).text);
  }
  return [];
}

function positiveNumber(value: unknown) {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return null;
  return value;
}

function normalizeTextAnswer(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/\s+/g, " ");
}

function parseAttemptAnswer(value?: string) {
  if (!value) return null;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
}

function firstAnswerValue(value: unknown) {
  if (Array.isArray(value)) return typeof value[0] === "string" ? value[0] : "";
  return typeof value === "string" ? value : "";
}

function arrayAnswerValue(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function stableQuizId(source: string) {
  let hash = 0x811c9dc5;
  for (const ch of source) {
    hash ^= ch.charCodeAt(0);
    hash = Math.imul(hash, 0x01000193);
  }
  return `quiz-${(hash >>> 0).toString(16)}`;
}

function formatScore(value: number) {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}
