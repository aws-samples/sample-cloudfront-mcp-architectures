# Contributing Guidelines

Thank you for your interest in contributing to our project. Whether it's a bug report, new feature, correction, or additional
documentation, we greatly value feedback and contributions from our community.

Read through this document before submitting any issues or pull requests so we have all the necessary
information to effectively respond to your bug report or contribution.

## Adding a pattern

1. Create `patterns/<n>-<origin>/` with an `origin.ts` that exports one function returning the pattern's CloudFront
   origin, and a `README.md` that embeds a draw.io diagram of what is deployed (source in
   `docs/diagrams/<name>/`, see its README). It receives `OriginProps` from `lib/waf.ts`:
   the shared hello image, the origin secret, the regional web ACL ARN, the shared VPC and the Cognito user pool.
2. Lock the origin so it is reachable only through CloudFront, and verify the token there with the origin's own
   verifier. Add the pattern's scope to `PATTERN_SCOPES` in `lib/auth.ts`.
3. In `lib/stack.ts`, give the pattern its own distribution with `mcpDistribution(...)`, and add its URL to the stack
   outputs. Add it to `PATTERN_STACKS` in `bin/app.ts` and
   `PATTERNS` in `cfn/synth.mjs`, then run `npm run cfn` for its template.
4. Run `npm test && npx cdk synth -q`, deploy, and save the output of `docs/e2e/cfn.sh` under `docs/e2e/`.

## Reporting Bugs/Feature Requests

We welcome you to use the GitHub issue tracker to report bugs or suggest features.

When filing an issue, check existing open, or recently closed, issues to see whether somebody else has already
reported the issue. Please try to include as much information as you can. Details like these are incredibly useful:

* A reproducible test case or series of steps
* The version of our code being used
* Any modifications you've made relevant to the bug
* Anything unusual about your environment or deployment

## Contributing through pull requests

Contributions through pull requests are much appreciated. Before sending us a pull request, check that:

1. You are working against the latest source on the *main* branch.
2. You check existing open, and recently merged, pull requests to see whether someone else has addressed the problem already.
3. You open an issue to discuss any work beyond a small fix, so your time isn't wasted.

To send us a pull request:

1. Fork the repository.
2. Modify the source. Focus on the specific change you are contributing. If you also reformat all the code, it will be hard for us to focus on your change.
3. Run the local tests and confirm they pass.
4. Commit to your fork using clear commit messages.
5. Send us a pull request, answering any default questions in the pull request interface.
6. Pay attention to any automated CI failures reported in the pull request, and stay involved in the conversation.

GitHub provides additional document on [forking a repository](https://help.github.com/articles/fork-a-repo/) and
[creating a pull request](https://help.github.com/articles/creating-a-pull-request/).

## Finding contributions to work on

Looking at the existing issues is a great way to find something to contribute on. As our projects, by default, use the default GitHub issue labels (enhancement/bug/duplicate/help wanted/invalid/question/wontfix), looking at any 'help wanted' issues is a great place to start.

## Code of Conduct

This project has adopted the [Amazon Open Source Code of Conduct](https://aws.github.io/code-of-conduct).
For more information see the [Code of Conduct FAQ](https://aws.github.io/code-of-conduct-faq) or contact
opensource-codeofconduct@amazon.com with any additional questions or comments.

## Security issue notifications

If you discover a potential security issue in this project we ask that you notify AWS/Amazon Security through our [vulnerability reporting page](http://aws.amazon.com/security/vulnerability-reporting/). Please do **not** create a public github issue.

## Licensing

See the [LICENSE](LICENSE) file for our project's licensing. We will ask you to confirm the licensing of your contribution.
