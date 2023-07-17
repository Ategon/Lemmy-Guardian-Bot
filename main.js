import LemmyBot from 'lemmy-bot';
import { load } from 'js-yaml'
import { readFileSync } from 'fs';
import 'dotenv/config';

let { instances, templates, markAsBot } = load(readFileSync('config.yaml', 'utf8'));

// -----------------------------------------------------------------------------
// Expand Templates
const expanded = {};

for (const [instance, instanceValue] of Object.entries(instances)) {
    const expandedInstance = {};

    for (const [community, communityValue] of Object.entries(instanceValue)) {
        const {templates: communityTemplates, ...expandedCommunity} = communityValue;

        if (communityTemplates) {
            for (const template of communityTemplates) {
                const templateInfo = Object.entries(templates).find(t => t[0] === template);

                if (templateInfo) {
                    const [templateName, templateValue] = templateInfo;
                    for (const [key, value] of Object.entries(templateValue)) {
                        if (expandedCommunity.hasOwnProperty(key)) {
                            expandedCommunity[key] = value;
                        } else {
                            expandedCommunity[key] = value;
                        }
                    }
                }
            }
        }

        expandedInstance[community] = expandedCommunity;
    }

    expanded[instance] = expandedInstance;
}

instances = expanded;

// -----------------------------------------------------------------------------
// Create Allow List
const allowList = [];

for (const [instance, instanceValue] of Object.entries(instances)) {
    const communities = [];
    for (const community of Object.keys(instanceValue)) {
        communities.push(community);
    }

    allowList.push({
        instance: instance,
        communities: communities
    });
}

// -----------------------------------------------------------------------------
// Main Bot Code
const bot = new LemmyBot.LemmyBot({
    markAsBot: markAsBot,
    instance: process.env.INSTANCE,
    credentials: {
        username: process.env.USERNAME,
        password: process.env.PASSWORD,
    },
    dbFile: 'db.sqlite3',
    federation: {
        allowList: allowList,
    },
    handlers: {
        post: {
            handle: async ({
                postView: {
                    post,
                    community,
                },
                botActions: { removePost, sendPrivateMessage, isCommunityMod, getUserId },
            }) => {
                let communityInfo = null;

                const instanceName = extractInstance(community.actor_id);
                const instanceInfo = instances[instanceName]
                if (instanceInfo) {
                    communityInfo = instanceInfo[community.name];
                }

                if (communityInfo) {
                    if (!checkValid(post.name, communityInfo.whitelist, communityInfo.blacklist)) {
                        if (!isCommunityMod({ community_id: community.id, user_id: getUserId(process.env.USERNAME) })) {
                            console.log(`Attempted to remove a post from ${community.name}@${instanceName} but the bot is not a mod.`);
                            return;
                        }

                        sendPrivateMessage({ recipient_id: post.creator_id, body: `Your post ${post.name} was removed because its title contains a URL not allowed by the community.` });
                        removePost({ post_id: post.id, reason: 'Title contains URL not allowed by the community' });
                    }
                    else if (post.body && !checkValid(post.body, communityInfo.whitelist, communityInfo.blacklist)) {
                        if (!isCommunityMod({ community_id: community.id, user_id: getUserId(process.env.USERNAME) })) {
                            console.log(`Attempted to remove a post from ${community.name}@${instanceName} but the bot is not a mod.`);
                            return;
                        }

                        sendPrivateMessage({ recipient_id: post.creator_id, body: `Your post ${post.name} was removed because its body contains a URL not allowed by the community.` });
                        removePost({ post_id: post.id, reason: 'Body contains URL not allowed by the community' });
                    }
                }
            }
        },
        comment: {
            handle: async ({
                commentView: {
                    comment,
                    community,
                },
                botActions: { removeComment, createComment, isCommunityMod, getUserId },
            }) => {
                let communityInfo = null;

                const instanceInfo = instances[extractInstance(community.actor_id)]
                if (instanceInfo) {
                    communityInfo = instanceInfo[community.name];
                }

                if (communityInfo) {
                    if (!checkValid(comment.content, communityInfo.whitelist, communityInfo.blacklist)) {
                        if (!isCommunityMod({ community_id: community.id, user_id: getUserId(process.env.USERNAME) })) {
                            console.log(`Attempted to remove a comment from ${community.name} but the bot is not a mod.`);
                            return;
                        }

                        await createComment({ post_id: comment.post_id, parent_id: comment.id, content: `Your comment was removed because it contains a URL not allowed by the community.` });
                        removeComment({ comment_id: comment.id, reason: 'Contains URL not allowed by the community' });
                    }
                }
            }
        }
    }
});

function checkValid(text, whitelist, blacklist) {
    var expression = /[-a-zA-Z0-9@:%._\+~#=]{1,256}\.[a-zA-Z0-9()]{1,6}\b([-a-zA-Z0-9()@:%_\+.~#?&//=]*)?/gi;
    var regex = new RegExp(expression);

    const matches = text.match(regex);

    if (!matches) return true;
    if (!whitelist && !blacklist) return false; // No whitelist or blacklist but community added means no URLs allowed
    if (whitelist && whitelist.length === 0 && blacklist && blacklist.length === 0) return false; // Empty whitelist and blacklist means no URLs allowed

    if (blacklist) {
        for (const item of blacklist) {
            if (matches.includes(item)) {
                return false;
            }
        }
    }

    if (whitelist) {
        for (const match of matches) {
            if (!whitelist.includes(match)) {
                return false;
            }
        }
    }

    return true;
}

function extractInstance(link) {
    const instanceName = new RegExp('.*\/\/(.*)\/c\/').exec(link)[1];

    return instanceName;
}

bot.start();