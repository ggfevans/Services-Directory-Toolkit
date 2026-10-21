// The options page. Each control's name is its setting's key in SDT.settings.schema, and a unit test
// (tests/unit/options-page.test.js) checks the page has one control per key, with the same values.
// Values are read and validated by SDT.settings and saved by SDT.writer.
{
  const SAVED = "Saved. Changes apply when you reload a page.";
  const EDITED_WHILE_SAVING = "Saved the values from when you pressed Save. You've changed the form since, so press Save again to keep those changes.";
  const EDITED_WITH_NOTHING_SAVED = "Nothing needed saving when you pressed Save. You've changed the form since, so press Save again to keep those changes.";
  const form = document.getElementById("settings");
  const status = document.getElementById("status");
  const saveButton = document.getElementById("save");
  const keys = SDT.settings.keys();
  // The values the form shows, as last read from storage. null until the first read, while the Save
  // button stays off.
  let loaded = null;
  let saving = false;

  // form.elements[key] is the control, or a RadioNodeList for a radio group. Setting a group's value
  // checks the radio with that value, so no selector is built from a stored value (SEC-9).
  const control = (key) => form.elements[key];
  const isBoolean = (key) => SDT.settings.entry(key).type === "boolean";
  // The error line under a field: the element whose id is the control's id plus "-error".
  const errorLine = (key) => document.getElementById(`${control(key).id}-error`);
  const errorKeys = keys.filter((key) => control(key).id && errorLine(key));

  const updateFeatureCountCheck = () => {
    control("autoFeatureCounts").disabled = !control("autoMetadata").checked;
  };

  const show = (values) => {
    for (const key of keys) {
      if (isBoolean(key)) {
        control(key).checked = values[key];
      } else {
        control(key).value = String(values[key]);
      }
    }
    updateFeatureCountCheck();
  };

  const markError = (key, message) => {
    errorLine(key).textContent = message;
    control(key).setAttribute("aria-invalid", "true");
  };

  const clearErrors = () => {
    for (const key of errorKeys) {
      errorLine(key).textContent = "";
      control(key).removeAttribute("aria-invalid");
    }
  };

  const notSaved = (count) => (count === 1 ? "Not saved. Fix the field marked below." : `Not saved. Fix the ${count} fields marked below.`);
  const bytes = (count) => count.toLocaleString("en-US");

  /** Validates every control. Returns { values, errors }, each keyed by setting. */
  const collect = () => {
    const values = {};
    const errors = {};
    for (const key of keys) {
      const result = SDT.settings.parse(key, isBoolean(key) ? control(key).checked : control(key).value);
      if ("error" in result) {
        errors[key] = result.error;
      } else {
        values[key] = result.value;
      }
    }
    return { values, errors };
  };

  /** True when every control still holds the value submitted in values. */
  const unchangedSince = (values) => {
    const now = collect();
    return keys.every((key) => Object.hasOwn(now.values, key) && now.values[key] === values[key]);
  };

  const showInvalid = (errors) => {
    const invalid = keys.filter((key) => Object.hasOwn(errors, key));
    invalid.forEach((key) => markError(key, errors[key]));
    status.textContent = notSaved(invalid.length);
    control(invalid[0]).focus();
  };

  const save = async () => {
    clearErrors();
    status.textContent = "";
    const { values, errors } = collect();
    if (Object.keys(errors).length) {
      showInvalid(errors);
      return;
    }
    let result;
    try {
      result = await SDT.writer.save(values, loaded);
    } catch (error) {
      status.textContent = `Not saved: ${SDT.writer.message(error)}. Nothing was changed.`;
      return;
    }
    if (result.quota?.key) {
      showInvalid({ [result.quota.key]: `Too long to sync: this needs ${bytes(result.quota.bytes)} bytes, and Chrome allows ${bytes(result.quota.limit)} per setting.` });
    } else if (result.quota) {
      status.textContent = `Not saved: the synced settings would need ${bytes(result.quota.bytes)} bytes, and Chrome allows ${bytes(result.quota.limit)}. Nothing was changed.`;
    } else if (result.error) {
      const kept = result.changed.map((key) => `"${SDT.settings.entry(key).label}"`).join(", ");
      status.textContent = kept
        ? `Not saved: ${result.error}. Only ${kept} changed.`
        : `Not saved: ${result.error}. Nothing was changed.`;
    } else {
      status.textContent = result.written.length ? SAVED : "No changes to save.";
      // Show what storage now holds, including changes made in another window to keys left alone here,
      // unless the user has edited the form since pressing Save. If that read fails, the writes still
      // succeeded, and storage holds what was submitted.
      try {
        loaded = await SDT.settings.read();
      } catch {
        loaded = values;
      }
      if (unchangedSince(values)) {
        show(loaded);
      } else {
        status.textContent = result.written.length ? EDITED_WHILE_SAVING : EDITED_WITH_NOTHING_SAVED;
      }
    }
  };

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (saving || loaded === null) {
      return;
    }
    saving = true;
    try {
      await save();
    } finally {
      saving = false;
    }
  });

  control("autoMetadata").addEventListener("change", updateFeatureCountCheck);

  const start = async () => {
    saveButton.disabled = true;
    try {
      loaded = await SDT.settings.read();
    } catch (error) {
      status.textContent = `Settings couldn't be loaded: ${SDT.writer.message(error)}. Reload this page to try again.`;
      return;
    }
    show(loaded);
    saveButton.disabled = false;
  };
  start();
}
