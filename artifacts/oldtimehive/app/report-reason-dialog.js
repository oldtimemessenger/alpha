let activeDialog = null;

export function requestReportReason({ minLength = 1, maxLength = 1000 } = {}) {
  if (activeDialog) return Promise.resolve(null);

  const dialog = document.createElement("dialog");
  dialog.className = "report-reason-dialog";
  dialog.setAttribute("aria-labelledby", "report-reason-title");
  dialog.innerHTML = `<form class="report-reason-form">
    <h2 id="report-reason-title">Why are you reporting this?</h2>
    <label for="report-reason-input">Reason</label>
    <textarea id="report-reason-input" name="reason" rows="4" maxlength="${maxLength}" required placeholder="Tell us what happened"></textarea>
    <p class="report-reason-error" role="alert" aria-live="polite"></p>
    <div class="report-reason-actions">
      <button type="button" data-report-cancel>Cancel</button>
      <button type="submit" class="report-reason-submit">Submit report</button>
    </div>
  </form>`;
  document.body.append(dialog);

  return new Promise(resolve => {
    let settled = false;
    const finish = value => {
      if (settled) return;
      settled = true;
      if (dialog.open) dialog.close();
      dialog.remove();
      if (activeDialog === dialog) activeDialog = null;
      resolve(value);
    };
    activeDialog = dialog;

    const form = dialog.querySelector("form");
    const textarea = dialog.querySelector("textarea");
    const error = dialog.querySelector(".report-reason-error");
    const cancel = dialog.querySelector("[data-report-cancel]");
    cancel.addEventListener("click", () => finish(null));
    dialog.addEventListener("cancel", event => {
      event.preventDefault();
      finish(null);
    });
    dialog.addEventListener("close", () => finish(null), { once: true });
    form.addEventListener("submit", event => {
      event.preventDefault();
      const reason = textarea.value.trim();
      if (!reason) {
        error.textContent = "Enter a reason to submit your report.";
        textarea.focus();
        return;
      }
      if (reason.length < minLength) {
        error.textContent = `Please add at least ${minLength} characters so the report can be reviewed.`;
        textarea.focus();
        return;
      }
      error.textContent = "";
      finish(reason.slice(0, maxLength));
    });
    textarea.addEventListener("input", () => { error.textContent = ""; });

    dialog.showModal();
    textarea.focus();
  });
}
