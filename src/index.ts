import { Application } from 'probot';
import { Context } from 'vm';

import fs from 'fs';
import child_process from 'child_process';
import async from 'async';

interface Commit {
    id: string;
    added: string[],
    removed: string[],
    modified: string[];
};

export = (app: Application) => {
    app.on('push', async (context) => {
        async function processMessage(file: string, line: string, info: string) {
            const commitId = context.payload.head_commit.id;
            const owner = context.payload.repository.owner.name;
            const repo = context.payload.repository.name;
            const pusher = context.payload.pusher.name;

            const body =
                `@${pusher}, your following code snippet makes the linter unhappy:
https://github.com/${owner}/${repo}/blob/${commitId}/${file}#L${line}`;

            await context.github.issues.create({
                owner: owner,
                repo: repo,
                title: `[${file}:${line}]: ${info}`,
                body: body,
                assignees: [pusher],
            }).then(() => {
                console.log("Creates an issue!");
            });
        }

        const commits: Commit[] = context.payload.commits;
        const files = commits
            .reduce((acc: string[], commit) =>
                acc.concat(commit.modified, [])
                , [])
            .filter(path => path.endsWith('.java'));


        const repoPath = "/tmp/" + context.payload.head_commit.id;

        fs.mkdir(repoPath, { recursive: true }, async (err) => {
            if (err) throw err;

            let calls = [];

            for (const file of files) {
                const response = await context.github.repos.getContents(
                    context.repo({
                        path: file,
                        ref: context.payload.head_commit.id
                    })
                );
                const content = Buffer.from(response.data.content, 'base64').toString('utf-8');
                const filePath = repoPath + '/' + file;
                calls.push(
                    fs.writeFile.bind(fs, filePath, content)
                );
            }

            async.parallel(calls, () => {
                child_process.exec(
                    `pmd -d ${repoPath} -f text -R rules.xml`,
                    (err, stdout) => {
                        return new Promise((
                            resolve: (result: string) => void,
                        ) => {
                            resolve(stdout);
                        }).then(
                            (result: string) => {
                                const cutLength = repoPath.length + 1;
                                const errorMsgs = result.split("\n")
                                    .map(msg => msg.substr(cutLength))
                                    .filter(msg => msg.length != 0)
                                    .map(msg =>
                                        (/^(.+):(\d+):\t(.+)$/g).exec(msg));
                                for (const msg of errorMsgs) {
                                    if (msg != null) {
                                        const file = msg[1];
                                        const line = msg[2];
                                        const info = msg[3];
                                        processMessage(file, line, info);
                                    } else {
                                        throw new Error("Cannot recognize the output format of the pmd linter");
                                    }
                                }
                            }
                        );
                    });
            });

        });

    });
}

//  LocalWords:  linter
