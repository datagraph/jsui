20260215

the tests take the form of a collection of javascript playwright drivers.
they were generated with claude code once a pass with "playwright codegen" had demonstrated that the scripts would work, but would take a long time to generate manually.

each can be executed separately or they can be executed as a set by

  cd jsui
  CAPTURE_DOCS=true npx playwright test tests/*-documented.spec.js

the environment declaration causes the test runner to capture the browser screen at the intervals and the file pater indicate to run the variants which have the capture operation included.
