const mongoose = require('mongoose');
mongoose.Promise = global.Promise;
const slug = require('slugs');

const postSchema = new mongoose.Schema({
    postDate: {
        type: Date,
        required: 'A date is required'
    },
    title: {
        type: String,
        trim: true,
        required: 'Please enter a title.'
    },
    description: {
        type: String,
        trim: true,
        required: false
    },
    images: [Object],
    author: [String],
    slug: String,
});

postSchema.pre('save', function(next) {
    if (!this.isModified('title')) {
        next();
        return;
    }
    this.slug = slug(this.title);
    next();
});

module.exports = mongoose.model('Post', postSchema);