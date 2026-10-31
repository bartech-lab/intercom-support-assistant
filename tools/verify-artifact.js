#!/usr/bin/env node
const {
  verifyExtractedArtifact,
  formatVerificationResults,
  hasErrors
} = require('./artifact-verifier');

function usage() {
  console.error('Usage: node verify-artifact.js /path/to/extracted-extension');
}

function main() {
  const artifactDir = process.argv[2];
  if (!artifactDir) {
    usage();
    process.exit(1);
  }

  const results = verifyExtractedArtifact(artifactDir);

  console.log(formatVerificationResults(results));
  if (hasErrors(results)) {
    process.exit(1);
  }
}

main();
