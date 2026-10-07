import { getFormatter, getTranslations } from "next-intl/server";
import { AuthForm, OptionalTextField } from "@/components/auth/form";
import { addComment, deleteComment, resolveThread } from "@/lib/projects/comment-actions";
import type { Comment, ProjectRole, Thread } from "@/lib/projects/comment-queries";

// Commentaires d'une section : fils de discussion, réponses, clôture. Rendu
// par la page du propriétaire et par celle d'un membre ; tout le texte passe
// par des nœuds de texte. Les formulaires exigent un fournisseur de messages
// « Auth » autour d'eux (AuthPageShell en pose un).

type Props = {
  scope: "owner" | "member";
  projectId: string;
  sectionId: string;
  /** Place de l'utilisateur dans le projet : seuls propriétaire et encadreur écrivent. */
  role: ProjectRole;
  threads: Thread[];
};

export async function CommentThreads({ scope, projectId, sectionId, role, threads }: Props) {
  const [t, format] = await Promise.all([getTranslations("Comments"), getFormatter()]);
  const canWrite = role === "owner" || role === "supervisor";

  const origin = (
    <>
      <input type="hidden" name="scope" value={scope} />
      <input type="hidden" name="projectId" value={projectId} />
      <input type="hidden" name="sectionId" value={sectionId} />
    </>
  );
  const author = (comment: Comment) =>
    comment.mine
      ? t("you")
      : comment.authorRole
        ? comment.authorEmail
          ? t("author", { role: t(`roles.${comment.authorRole}`), email: comment.authorEmail })
          : t(`roles.${comment.authorRole}`)
        : t("formerMember");
  const when = (comment: Comment) =>
    format.dateTime(new Date(comment.createdAt), { dateStyle: "medium", timeStyle: "short" });

  const message = (comment: Comment) => (
    <div className="flex flex-col gap-1">
      <p className="text-sm opacity-80">
        <span className="font-medium">{author(comment)}</span>
        {t("separator")}
        {when(comment)}
        {comment.edited && !comment.deleted ? `${t("separator")}${t("edited")}` : ""}
      </p>
      {comment.deleted ? (
        <p className="italic opacity-70">{t("deleted")}</p>
      ) : (
        <p className="whitespace-pre-line">{comment.body}</p>
      )}
      {comment.mine && !comment.deleted ? (
        <AuthForm action={deleteComment} submitLabel={t("delete")} pendingLabel={t("pending")}>
          {origin}
          <input type="hidden" name="commentId" value={comment.id} />
        </AuthForm>
      ) : null}
    </div>
  );

  const open = threads.filter((thread) => !thread.resolved).length;

  return (
    <section id="comments" className="flex flex-col gap-4">
      <h2 className="text-lg font-semibold">{t("heading", { count: threads.length })}</h2>
      {threads.length > 0 ? (
        <p className="text-sm opacity-80" data-testid="open-threads">
          {t("open", { count: open })}
        </p>
      ) : (
        <p className="opacity-70">{canWrite ? t("empty") : t("emptyReadOnly")}</p>
      )}

      <ul className="flex flex-col gap-4">
        {threads.map((thread) => (
          <li
            key={thread.id}
            data-testid="thread"
            data-resolved={thread.resolved ? "true" : "false"}
            className="flex flex-col gap-3 rounded border border-foreground/20 p-3"
          >
            {thread.resolved ? <p className="text-sm font-medium">{t("resolvedBadge")}</p> : null}
            {thread.quote ? (
              <blockquote className="border-s-4 border-foreground/30 ps-3 text-sm opacity-80">
                <span className="block text-xs opacity-80">{t("quoteLabel")}</span>
                {thread.quote}
              </blockquote>
            ) : null}
            {message(thread)}

            {thread.replies.length > 0 ? (
              <ul className="flex flex-col gap-3 border-s border-foreground/20 ps-4">
                {thread.replies.map((reply) => (
                  <li key={reply.id} data-testid="reply">
                    {message(reply)}
                  </li>
                ))}
              </ul>
            ) : null}

            {canWrite ? (
              <div className="flex flex-col gap-3">
                {!thread.resolved ? (
                  <AuthForm action={addComment} submitLabel={t("reply")} pendingLabel={t("pending")}>
                    {origin}
                    <input type="hidden" name="parentId" value={thread.id} />
                    <OptionalTextField name="body" label={t("fields.reply")} maxLength={2000} rows={2} required />
                  </AuthForm>
                ) : null}
                <AuthForm
                  action={resolveThread}
                  submitLabel={thread.resolved ? t("reopen") : t("resolve")}
                  pendingLabel={t("pending")}
                >
                  {origin}
                  <input type="hidden" name="commentId" value={thread.id} />
                  <input type="hidden" name="resolved" value={thread.resolved ? "false" : "true"} />
                </AuthForm>
              </div>
            ) : null}
          </li>
        ))}
      </ul>

      {canWrite ? (
        <div className="flex flex-col gap-2">
          <h3 className="font-semibold">{t("newHeading")}</h3>
          <AuthForm action={addComment} submitLabel={t("add")} pendingLabel={t("pending")}>
            {origin}
            <OptionalTextField
              name="quote"
              label={t("fields.quote")}
              hint={t("fields.quoteHint")}
              maxLength={400}
              rows={2}
            />
            <OptionalTextField name="body" label={t("fields.body")} maxLength={2000} rows={4} required />
          </AuthForm>
        </div>
      ) : null}
    </section>
  );
}
