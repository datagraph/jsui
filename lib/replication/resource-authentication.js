
/**
 Present authentication dialogs:
   authentication_credentials_prompt
   authentication_token_prompt

 The credentials version includes fields for identity and password.
 The token version accepts just an authentication token.
 They are invoked with default field values and a continuation.
 If confirmed, invoke that continuation with an authentication object {identity: token: password:}
 Allow an optional cancel continuation.
 */
// https://stackoverflow.com/questions/9554987/how-can-i-hide-the-password-entered-via-a-javascript-dialog-prompt

export function authentication_set(location, authentication) {
    return (responseHandler.setAuthentication(location, authentication));
  }
  
  export function authentication_prompt(options) {
    return (authentication_token_prompt(options));
  }
  
  
  export function authentication_credentials_prompt(options) {
      var title = options.title || "Please enter",
          host = options.host || Cell.hostname,
          identityLabel = options.identityLabel || "Identity",
          passwordLabel = options.passwordLabel || "Password",
          submitLabel = options.submitLabel || "Submit",
          cancelLabel = options.cancelLabel || "Cancel";
      var position = options.position || [4,4];
      var submitContinuation = options.submit || options.accept;
      var cancelContinuation = options.cancel;
      if(! submitContinuation) { 
        throw (new Error("authentication_prompt requires a commit continuation."));
      };
                     
      var prompt = document.createElement("form");
      prompt.className = "authentication_prompt dialog";
      
      var submit = function() {
        var identity = identityInput.value;
        if (identity.length == 0) {identity = null; }
        var password = passwordInput.value;
        if (password.length == 0) {password = null; }
        document.body.removeChild(prompt);
        submitContinuation((identity || "") + ":" + (password || ""));
      };
      var cancel = function() {
          document.body.removeChild(prompt);
          if (cancelContinuation) {
            cancelContinuation();
          }
      };
      var handleReturn = function(e) {
          if (e.keyCode == 13) submit();
      }
      var titleElement = document.createElement("div");
      titleElement.id = "title";
      titleElement.textContent = `${title} (@${host})`;
      prompt.appendChild(titleElement);
  
      var passwordLabelElement = document.createElement("label");
      passwordLabelElement.id = "passwordLabel";
      passwordLabelElement.textContent = passwordLabel;
      prompt.appendChild(passwordLabelElement);
  
      var passwordInput = document.createElement("input");
      passwordInput.type = "password";
      passwordInput.value = options.password || "";
      passwordInput.addEventListener("keyup", handleReturn, false);
      prompt.appendChild(passwordInput);
  
      var identityLabelElement = document.createElement("label");
      identityLabelElement.id = "identityLabel";
      identityLabelElement.textContent = identityLabel;
      prompt.appendChild(identityLabelElement);
  
      var identityInput = document.createElement("input");
      identityInput.addEventListener("keyup", handleReturn, false);
      identityInput.value = options.identity || "";
      prompt.appendChild(identityInput);
  
      var submitButton = document.createElement("button");
      submitButton.textContent = submitLabel;
      submitButton.id = "submit";
      submitButton.addEventListener("click", submit, false);
      prompt.appendChild(submitButton);
      var cancelButton = document.createElement("button");
      cancelButton.textContent = cancelLabel;
      cancelButton.id = "cancel";
      cancelButton.addEventListener("click", cancel, false);
      prompt.appendChild(cancelButton);
      prompt.style.zIndex = 100;
      prompt.style.position = "fixed";
      if (position[0] < 0) {
        prompt.style.right = (-position[0])+'px';
      } else {
        prompt.style.left = position[0]+'px';
      }
      if (position[1] < 0) {
        prompt.style.bottom = (-position[1])+'px';
      } else {
        prompt.style.top = position[1]+'px';
      }
      document.body.appendChild(prompt);
  };
  
  
  export function authentication_token_prompt(options) {
      var title = options.title || "Please enter for",
          host = options.host || Cell.hostname,
          tokenLabel = options.tokenLabel || "Token",
          submitLabel = options.submitLabel || "Submit",
          cancelLabel = options.cancelLabel || "Cancel";
      var position = options.position || [20,20];
      var submitContinuation = options.submit || options.accept;
      var cancelContinuation = options.cancel;
  
  console.log("authentication_token_prompt", options);
      if(! submitContinuation) { 
        throw (new Error("authentication_prompt requires a commit continuation."));
      };
                     
      var prompt = document.createElement("form");
      prompt.className = "authentication_prompt dialog";
      
      var submit = function() {
        var token = tokenInput.value;
        if (token.length == 0) {token = null; }
        document.body.removeChild(prompt);
        submitContinuation(":" + (token || ""));
      };
      var cancel = function() {
          document.body.removeChild(prompt);
          if (cancelContinuation) {
            cancelContinuation();
          }
      };
      var handleReturn = function(e) {
          if (e.keyCode == 13) submit();
      }
      var titleElement = document.createElement("div");
      titleElement.id = "title";
      titleElement.textContent = `${title} (@${host})`;
      prompt.appendChild(titleElement);
  
      var tokenLabelElement = document.createElement("label");
      tokenLabelElement.id = "tokenLabel";
      tokenLabelElement.textContent = tokenLabel;
      prompt.appendChild(tokenLabelElement);
  
      var tokenInput = document.createElement("input");
      tokenInput.type = "password";
      tokenInput.value = options.token || "";
      tokenInput.addEventListener("keyup", handleReturn, false);
      prompt.appendChild(tokenInput);
  
      var submitButton = document.createElement("button");
      submitButton.textContent = submitLabel;
      submitButton.id = "submit";
      submitButton.addEventListener("click", submit, false);
      prompt.appendChild(submitButton);
      var cancelButton = document.createElement("button");
      cancelButton.textContent = cancelLabel;
      cancelButton.id = "cancel";
      cancelButton.addEventListener("click", cancel, false);
      prompt.appendChild(cancelButton);
      prompt.style.zIndex = 100;
      prompt.style.position = "fixed";
      if (position[0] < 0) {
        prompt.style.right = (-position[0])+'px';
      } else {
        prompt.style.left = position[0]+'px';
      }
      if (position[1] < 0) {
        prompt.style.bottom = (-position[1])+'px';
      } else {
        prompt.style.top = position[1]+'px';
      }
      document.body.appendChild(prompt);
  };
  
  if ( typeof document !== "undefined") {
  
  if (! document.querySelector('#authentication_prompt_style')) {
    var style = document.createElement('style');
    style.id = "authentication_prompt_style";
    style.type = "text/css";
    style.innerText = `
  .authentication_prompt {
      font-size: 10pt;
      position:fixed;
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      grid-template-rows: repeat(4, 1fr);
      border: solid 2px black;
      border-radius: 4px;
      width: 300px;
  }
  .authentication_prompt #title {
      display:block;
      background-color: #f8f8f8;
      text-align: center; 
      grid-column-start: 1;
      grid-column-end: 4;
      grid-row: 1;
      border-bottom: solid 1px black;
      margin-left: 4px;
      margin-right: 4px;
      margin-bottom: 2px;
  }
  .authentication_prompt label {
      display:block; 
      grid-column-start: 1;
      grid-column-end: 2;
      width: 7em;
      margin-left: 4px;
  }
  .authentication_prompt input {
      display:block; 
      grid-column-start: 2;
      grid-column-end: 4;
      width: auto;
      margin-right: 4px;
  }
  .authentication_prompt button {
      display:block; 
      grid-row-start: 4;
      grid-row-end: 5;
      margin-left: 4px;
      margin-right: 4px;
      margin-top: 1px
  }
  .authentication_prompt #submit { grid-column: 1; }
  .authentication_prompt #cancel { grid-column: 3; }
  `;
    document.querySelector('head').appendChild(style);
  }
  window.authentication_prompt = authentication_prompt;
  window.authentication_token_prompt = authentication_token_prompt;
  window.authentication_credentials_prompt = authentication_credentials_prompt;
  
  }
  