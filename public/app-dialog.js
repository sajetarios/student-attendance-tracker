'use strict';

(() => {
  if (window.AppDialog) return;

  const queue = [];
  let isShowing = false;
  let dialogSequence = 0;

  function enqueue(config) {
    return new Promise(resolve => {
      queue.push({ config, resolve });
      processQueue();
    });
  }

  async function processQueue() {
    if (isShowing) return;
    isShowing = true;
    while (queue.length) {
      const item = queue.shift();
      try {
        item.resolve(await present(item.config));
      } catch (error) {
        console.error('Application dialog failed:', error);
        item.resolve(item.config.kind === 'confirm' ? false : null);
      }
    }
    isShowing = false;
  }

  function present(config) {
    return new Promise(resolve => {
      const id = ++dialogSequence;
      const previousFocus = document.activeElement;
      const previousOverflow = document.body.style.overflow;
      const isPrompt = config.kind === 'prompt';
      const isForm = config.kind === 'form';
      const isConfirm = config.kind === 'confirm';
      const isAlert = config.kind === 'alert';
      const cancelValue = isConfirm ? false : null;
      let finished = false;

      const overlay = document.createElement('div');
      overlay.className = 'app-dialog-overlay';
      overlay.dataset.dialogId = String(id);

      const panel = document.createElement('section');
      panel.className = 'app-dialog-card';
      panel.setAttribute('role', 'dialog');
      panel.setAttribute('aria-modal', 'true');
      panel.setAttribute('aria-labelledby', 'app-dialog-title-' + id);
      panel.setAttribute('aria-describedby', 'app-dialog-message-' + id);
      panel.setAttribute('tabindex', '-1');

      const header = document.createElement('div');
      header.className = 'app-dialog-header';

      const icon = document.createElement('span');
      icon.className = 'app-dialog-icon' + (config.variant === 'danger' ? ' is-danger' : '');
      icon.setAttribute('aria-hidden', 'true');
      icon.textContent = (isPrompt || isForm) ? '✎' : isAlert ? 'i' : config.variant === 'danger' ? '!' : '?';

      const heading = document.createElement('div');
      heading.className = 'app-dialog-heading';

      const eyebrow = document.createElement('span');
      eyebrow.className = 'app-dialog-eyebrow';
      eyebrow.textContent = config.eyebrow || ((isPrompt || isForm) ? 'INPUT REQUIRED' : isAlert ? 'NOTICE' : 'CONFIRMATION');

      const title = document.createElement('h2');
      title.id = 'app-dialog-title-' + id;
      title.textContent = config.title || ((isPrompt || isForm) ? 'Enter information' : isAlert ? 'Please note' : config.variant === 'danger' ? 'Confirm this action' : 'Please confirm');

      heading.append(eyebrow, title);
      header.append(icon, heading);

      const closeButton = document.createElement('button');
      closeButton.type = 'button';
      closeButton.className = 'app-dialog-close';
      closeButton.setAttribute('aria-label', 'Close dialog');
      closeButton.title = 'Close';
      closeButton.textContent = '×';
      closeButton.addEventListener('click', () => finish(cancelValue));
      header.append(closeButton);

      const message = document.createElement('p');
      message.className = 'app-dialog-message';
      message.id = 'app-dialog-message-' + id;
      message.textContent = String(config.message ?? '');

      const form = document.createElement('form');
      form.className = 'app-dialog-form';
      form.noValidate = true;

      let field = null;
      let errorText = null;
      const fieldControls = [];

      const buildControl = (fieldConfig, fieldId) => {
        let control;
        if (Array.isArray(fieldConfig.selectOptions)) {
          control = document.createElement('select');
          control.className = 'app-dialog-input';
          const blank = document.createElement('option');
          blank.value = '';
          blank.textContent = fieldConfig.placeholder || 'Choose an option';
          control.append(blank);
          for (const optionItem of fieldConfig.selectOptions) {
            const option = document.createElement('option');
            option.value = typeof optionItem === 'string' ? optionItem : String(optionItem.value ?? '');
            option.textContent = typeof optionItem === 'string' ? optionItem : String(optionItem.label ?? optionItem.value ?? '');
            control.append(option);
          }
        } else if ((fieldConfig.inputType || fieldConfig.type) === 'textarea') {
          control = document.createElement('textarea');
          control.rows = fieldConfig.rows || 3;
          control.className = 'app-dialog-input app-dialog-textarea';
        } else {
          control = document.createElement('input');
          const inputType = fieldConfig.inputType || fieldConfig.type || 'text';
          control.type = ['text','number','email','tel','date','password'].includes(inputType) ? inputType : 'text';
          control.className = 'app-dialog-input';
        }
        control.id = fieldId;
        control.name = fieldConfig.name;
        control.autocomplete = 'off';
        control.spellcheck = false;
        control.value = String(fieldConfig.defaultValue ?? '');
        if (fieldConfig.placeholder && !Array.isArray(fieldConfig.selectOptions)) control.placeholder = fieldConfig.placeholder;
        if (Number.isInteger(fieldConfig.maxLength)) control.maxLength = fieldConfig.maxLength;
        if (fieldConfig.inputMode) control.inputMode = fieldConfig.inputMode;
        if (fieldConfig.required) control.setAttribute('aria-required', 'true');
        return control;
      };

      if (isPrompt) {
        const fieldWrap = document.createElement('div');
        fieldWrap.className = 'app-dialog-field';
        const label = document.createElement('label');
        label.className = 'app-dialog-label';
        label.textContent = config.label || 'Your response';
        label.htmlFor = 'app-dialog-input-' + id;
        field = buildControl(config, 'app-dialog-input-' + id);
        field.name = 'response';
        const help = document.createElement('span');
        help.className = 'app-dialog-help';
        help.textContent = config.helpText || '';
        errorText = document.createElement('span');
        errorText.className = 'app-dialog-error';
        errorText.setAttribute('role', 'alert');
        errorText.setAttribute('aria-live', 'polite');
        fieldWrap.append(label, field);
        if (config.helpText) fieldWrap.append(help);
        fieldWrap.append(errorText);
        form.append(fieldWrap);
      } else if (isForm) {
        const fieldsWrap = document.createElement('div');
        fieldsWrap.className = 'app-dialog-fields';
        (Array.isArray(config.fields) ? config.fields : []).forEach((fieldConfig, index) => {
          if (!fieldConfig || typeof fieldConfig.name !== 'string' || !fieldConfig.name.trim()) return;
          const fieldWrap = document.createElement('div');
          fieldWrap.className = 'app-dialog-field';
          const label = document.createElement('label');
          label.className = 'app-dialog-label';
          label.textContent = fieldConfig.label || fieldConfig.name;
          const fieldId = 'app-dialog-input-' + id + '-' + index;
          label.htmlFor = fieldId;
          const control = buildControl(fieldConfig, fieldId);
          const help = document.createElement('span');
          help.className = 'app-dialog-help';
          help.textContent = fieldConfig.helpText || '';
          const fieldError = document.createElement('span');
          fieldError.className = 'app-dialog-error';
          fieldError.setAttribute('role', 'alert');
          fieldError.setAttribute('aria-live', 'polite');
          fieldWrap.append(label, control);
          if (fieldConfig.helpText) fieldWrap.append(help);
          fieldWrap.append(fieldError);
          fieldsWrap.append(fieldWrap);
          fieldControls.push({ config: fieldConfig, field: control, error: fieldError });
        });
        form.append(fieldsWrap);
      }
      const footer = document.createElement('div');
      footer.className = 'app-dialog-actions';

      const cancelButton = document.createElement('button');
      cancelButton.type = 'button';
      cancelButton.className = 'app-dialog-button app-dialog-button-secondary';
      cancelButton.textContent = config.cancelText || 'Cancel';
      cancelButton.addEventListener('click', () => finish(cancelValue));

      const submitButton = document.createElement('button');
      submitButton.type = isPrompt || isForm || isAlert ? 'submit' : 'button';
      submitButton.className = 'app-dialog-button app-dialog-button-primary' + (config.variant === 'danger' ? ' is-danger' : '');
      submitButton.textContent = config.confirmText || ((isPrompt || isForm) ? 'Continue' : isAlert ? 'Got it' : 'Confirm');
      submitButton.addEventListener('click', event => {
        if (isConfirm) {
          event.preventDefault();
          finish(true);
        }
      });

      if (!isAlert) footer.append(cancelButton);
      footer.append(submitButton);
      form.append(footer);

      form.addEventListener('submit', event => {
        event.preventDefault();
        if (isPrompt) {
          const value = field.value;
          if (config.required && !String(value).trim()) {
            errorText.textContent = config.requiredMessage || 'This field is required.';
            field.setAttribute('aria-invalid', 'true');
            field.focus();
            return;
          }
          if (typeof config.validate === 'function') {
            const validation = config.validate(value);
            if (validation !== true && validation !== undefined && validation !== null) {
              errorText.textContent = typeof validation === 'string' ? validation : 'Please check your entry.';
              field.setAttribute('aria-invalid', 'true');
              field.focus();
              return;
            }
          }
          finish(value);
        } else if (isForm) {
          const values = {};
          for (const item of fieldControls) {
            const value = item.field.value;
            if (item.config.required && !String(value).trim()) {
              item.error.textContent = item.config.requiredMessage || 'This field is required.';
              item.field.setAttribute('aria-invalid', 'true');
              item.field.focus();
              return;
            }
            if (typeof item.config.validate === 'function') {
              const validation = item.config.validate(value, values);
              if (validation !== true && validation !== undefined && validation !== null) {
                item.error.textContent = typeof validation === 'string' ? validation : 'Please check your entry.';
                item.field.setAttribute('aria-invalid', 'true');
                item.field.focus();
                return;
              }
            }
            values[item.config.name] = value;
          }
          if (typeof config.validate === 'function') {
            const validation = config.validate(values);
            if (validation !== true && validation !== undefined && validation !== null) {
              if (fieldControls[0]) {
                fieldControls[0].error.textContent = typeof validation === 'string' ? validation : 'Please check your entries.';
                fieldControls[0].field.setAttribute('aria-invalid', 'true');
                fieldControls[0].field.focus();
              }
              return;
            }
          }
          finish(values);
        } else if (isAlert) {
          finish(undefined);
        }
      });

      panel.append(header, message, form);
      overlay.append(panel);
      document.body.append(overlay);
      document.body.style.overflow = 'hidden';
      document.body.classList.add('app-dialog-open');

      function finish(value) {
        if (finished) return;
        finished = true;
        document.removeEventListener('keydown', onDocumentKeydown, true);
        overlay.remove();
        document.body.style.overflow = previousOverflow;
        if (!document.querySelector('.app-dialog-overlay')) document.body.classList.remove('app-dialog-open');
        if (previousFocus && typeof previousFocus.focus === 'function' && document.contains(previousFocus)) {
          previousFocus.focus({ preventScroll: true });
        }
        resolve(value);
      }

      function onDocumentKeydown(event) {
        if (event.key === 'Escape') {
          event.preventDefault();
          event.stopPropagation();
          finish(cancelValue);
          return;
        }
        if (event.key !== 'Tab') return;
        const focusable = [...panel.querySelectorAll('button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])')]
          .filter(element => !element.hidden);
        if (!focusable.length) {
          event.preventDefault();
          panel.focus();
          return;
        }
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }

      overlay.addEventListener('pointerdown', event => {
        if (event.target === overlay) finish(cancelValue);
      });
      document.addEventListener('keydown', onDocumentKeydown, true);

      requestAnimationFrame(() => {
        if (field) {
          field.focus();
          if (typeof field.select === 'function' && !Array.isArray(config.selectOptions)) field.select();
        } else if (fieldControls.length) {
          fieldControls[0].field.focus();
        } else {
          submitButton.focus();
        }
      });
    });
  }

  window.AppDialog = Object.freeze({
    alert(message, options = {}) {
      return enqueue({ ...options, kind: 'alert', message });
    },
    confirm(message, options = {}) {
      return enqueue({ ...options, kind: 'confirm', message });
    },
    prompt(message, defaultValue = '', options = {}) {
      return enqueue({ ...options, kind: 'prompt', message, defaultValue });
    },
    form(message, fields, options = {}) {
      return enqueue({ ...options, kind: 'form', message, fields });
    }
  });
})();
