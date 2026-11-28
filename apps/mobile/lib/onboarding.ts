// "Skip for now" lasts until the app is closed, so nobody is trapped on the
// onboarding screen but it comes back next launch until the profile is done.
let skipped = false;

export function markOnboardingSkipped() {
  skipped = true;
}

export function onboardingWasSkipped() {
  return skipped;
}
