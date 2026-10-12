import { escapeHtml } from '../utils.js';
export { readLastUsername } from '../../lib/models/session.js';

/**
 * Build the shared login form HTML.
 *
 * This fragment is used by both LoginPage (user app) and AdminLoginPage (admin
 * app).  The testids are identical across both apps — login tests only need to
 * know which URL they started from, not which app they are in.
 *
 * Included elements:
 *   - #login-error / #login-error-text  — error alert box (hidden by default)
 *   - #inline-login-form                — the form itself
 *   - data-testid: login-form, login-host-input, login-username-input,
 *                  login-password-input, login-submit
 */
export const buildLoginFormHtml = (lastUsername = '') => `
  <div id="login-error" class="widget" style="display:none;">
    <div class="alert-error rounded">
      <p class="message">
        <span class="icon icon-alert"></span>
        <span id="login-error-text"></span>
      </p>
    </div>
  </div>
  <form id="inline-login-form" class="formtastic" onsubmit="return false;" data-testid="login-form">
    <fieldset class="inputs">
      <ol>
        <li class="string optional"><label>Host</label><input type="text" name="host" placeholder="dydra.com" data-testid="login-host-input" /></li>
        <li class="string optional"><label>Username</label><input type="text" name="login" value="${escapeHtml(lastUsername)}" data-testid="login-username-input" /></li>
        <li class="password optional"><label>Password or Token</label><input type="password" name="password" data-testid="login-password-input" /></li>
      </ol>
    </fieldset>
    <fieldset class="buttons">
      <ol>
        <li class="commit"><input type="submit" value="Log in" data-testid="login-submit" /></li>
      </ol>
    </fieldset>
  </form>
`;
