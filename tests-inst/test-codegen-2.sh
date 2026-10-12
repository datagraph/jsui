#! /bin/sh

npx playwright codegen --test-id-attribute=data-testid --target=playwright-test --output=studio-recorded.spec.js https://dydra.com/ui/user
