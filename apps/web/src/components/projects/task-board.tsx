import { getFormatter, getTranslations } from "next-intl/server";
import { AuthForm, OptionalTextField } from "@/components/auth/form";
import { addTask, deleteTask, toggleTask } from "@/lib/projects/task-actions";
import type { ProjectTasks, Task } from "@/lib/projects/task-queries";

// Tâches et échéances d'un projet. Rendu par la page du propriétaire et par
// celle d'un membre ; les formulaires exigent un fournisseur de messages
// « Auth » autour d'eux (AuthPageShell en pose un).

type Props = {
  scope: "owner" | "member";
  projectId: string;
  listing: ProjectTasks;
  /** Aujourd'hui, au format AAAA-MM-JJ, pour signaler les échéances dépassées. */
  today: string;
};

export async function TaskBoard({ scope, projectId, listing, today }: Props) {
  const [t, format] = await Promise.all([getTranslations("Tasks"), getFormatter()]);
  const canCreate = listing.role === "owner" || listing.role === "supervisor";
  const open = listing.tasks.filter((task) => !task.done);
  const done = listing.tasks.filter((task) => task.done);

  const origin = (
    <>
      <input type="hidden" name="scope" value={scope} />
      <input type="hidden" name="projectId" value={projectId} />
    </>
  );
  const due = (task: Task) =>
    task.dueDate
      ? format.dateTime(new Date(`${task.dueDate}T00:00:00Z`), { dateStyle: "long", timeZone: "UTC" })
      : null;

  const item = (task: Task) => {
    const late = !task.done && task.dueDate !== null && task.dueDate < today;
    return (
      <li
        key={task.id}
        data-testid="task"
        data-done={task.done ? "true" : "false"}
        className="flex flex-col gap-2 rounded border border-foreground/20 p-3"
      >
        <p className={task.done ? "font-medium line-through opacity-70" : "font-medium"}>{task.title}</p>
        <p className="text-sm opacity-80">
          {[
            task.authorRole ? t("setBy", { role: t(`roles.${task.authorRole}`) }) : t("setByFormer"),
            due(task) ? t(late ? "overdue" : "dueOn", { date: due(task) ?? "" }) : t("noDueDate"),
          ].join(t("separator"))}
        </p>
        {task.details ? <p className="whitespace-pre-line">{task.details}</p> : null}
        {task.editable ? (
          <div className="flex flex-wrap gap-4">
            <AuthForm
              action={toggleTask}
              submitLabel={task.done ? t("reopen") : t("markDone")}
              pendingLabel={t("pending")}
            >
              {origin}
              <input type="hidden" name="taskId" value={task.id} />
              <input type="hidden" name="done" value={task.done ? "false" : "true"} />
            </AuthForm>
            <AuthForm action={deleteTask} submitLabel={t("delete")} pendingLabel={t("pending")} destructive>
              {origin}
              <input type="hidden" name="taskId" value={task.id} />
            </AuthForm>
          </div>
        ) : null}
      </li>
    );
  };

  return (
    <>
      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">{t("openHeading", { count: open.length })}</h2>
        {open.length === 0 ? (
          <p className="opacity-70">{t("openEmpty")}</p>
        ) : (
          <ul className="flex flex-col gap-3">{open.map(item)}</ul>
        )}
      </section>

      {done.length > 0 ? (
        <section className="flex flex-col gap-3">
          <h2 className="text-lg font-semibold">{t("doneHeading", { count: done.length })}</h2>
          <ul className="flex flex-col gap-3">{done.map(item)}</ul>
        </section>
      ) : null}

      {canCreate ? (
        <section className="flex flex-col gap-3">
          <h2 className="text-lg font-semibold">{t("addHeading")}</h2>
          <AuthForm action={addTask} submitLabel={t("add")} pendingLabel={t("pending")}>
            {origin}
            <OptionalTextField name="title" label={t("fields.title")} maxLength={200} required />
            <OptionalTextField name="details" label={t("fields.details")} maxLength={1000} rows={3} />
            <OptionalTextField
              name="dueDate"
              label={t("fields.dueDate")}
              hint={t("fields.dueDateHint")}
              maxLength={10}
            />
          </AuthForm>
        </section>
      ) : null}
    </>
  );
}
