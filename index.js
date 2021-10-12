const express = require('express');
const multer  = require('multer');
const session = require('express-session');
const mongoSessionStore = require('connect-mongo');
const { body, validationResult } = require('express-validator');
const passport = require('passport');
const mongoose = require('mongoose');
const flash = require('connect-flash');
const sharp = require('sharp');
const fs = require('fs');
const util = require('util');

require('dotenv').config({path: 'variables.env'});

const clientPromise = mongoose.connect(process.env.DATABASE);
mongoose.Promise = global.Promise;
mongoose.connection.on('error', (err)=>{
    console.error(`Mongoose fail: ${err.message}`);
});

const app = express();
const port = 80;

app.set('trust proxy', 1)
app.use(session({
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: true,
    store: mongoSessionStore.create({ mongoUrl: process.env.DATABASE })
}));
app.use(passport.initialize());
app.use(passport.session());

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

//Serve static content  I.e., http://localhost/test.html
app.use(express.static('./static'));

app.use(flash());

//Use EJS templates for pages with dynamic content
app.set('view engine', 'ejs');
app.set('views', './views');

require('./models/Post');
require('./models/User');
const Post = mongoose.model('Post');
const User = mongoose.model('User');
// CHANGE: USE "createStrategy" INSTEAD OF "authenticate"
passport.use(User.createStrategy());

passport.serializeUser(User.serializeUser());
passport.deserializeUser(User.deserializeUser());


const origUploadPath = 'static/images/original';
const upload = multer({ dest: origUploadPath });
const smallImageWidth = 450;
const smallImagePath = 'static/images/small/';
const smallImagePathPart = 'images/small/';
const mediumImageWidth = 800;
const mediumImagePath = 'static/images/medium/';
const mediumImagePathPart = 'images/medium/';
const largeImageWidth = 1400;
const largeImagePath ='static/images/large/';
const largeImagePathPart = 'images/large/';

//Make sure our directories are there. This is an immediately invoked function
//expression so we can do async/await at the top level
(async function() {
    try {
        await fs.promises.mkdir(origUploadPath, { recursive: true });
        await fs.promises.mkdir(smallImagePath, { recursive: true });
        await fs.promises.mkdir(mediumImagePath, { recursive: true });
        await fs.promises.mkdir(largeImagePath, { recursive: true });
    } catch (err) {
        console.log(err);
    }
})();

app.get('/', async (req, res) => {
    try {
        const posts = await Post.find();
        res.render('pages/index', {posts: posts});
    } catch(err) {
        console.error('failed');
        console.error(err);
    }
});

app.get('/post/:id', async (req, res) => {
    const post = await Post.findOne({ _id: req.params.id });
    res.render('pages/post', {post: post});
});

app.get('/dash', (req, res) => {
    if (req.user) {
        res.render('pages/dash');
    } else {
        res.redirect('/login');
    }
});

app.get('/login', (req, res) => {
    res.render('pages/login');
});

app.post('/login', passport.authenticate('local', { successRedirect: '/dash',
                                                    failureRedirect: '/login' }));

app.get('/logout', function(req, res){
    req.logout();
    res.redirect('/');
    });

app.get('/register', (req, res) => {
    const flashes = req.flash();
    res.render('pages/register', {errorFlashes: flashes.error});
});

app.post('/register',
    body('name').notEmpty().withMessage('Please enter your name.'),
    body('email').isEmail().withMessage('Please enter a valid email address.').normalizeEmail({
        remove_dots: false,
        remove_extension: false,
        gmail_remove_subaddress: false
    }),
    body('password').notEmpty().withMessage('Password Cannot be Blank!').isLength({ min: 8 }).withMessage('Password must be 8 to 40 characters.').isLength({ max: 40 }).withMessage('Password must be 8 to 40 characters.'),
    body('passwordconfirm').notEmpty().withMessage('Confirmed Password cannot be blank!'),
    async (req, res) => {
        const result = validationResult(req);
        if (!Array.isArray(result.errors)) {
            result.errors = [];
        }
        if (req.body.password !== req.body.passwordconfirm) {
            result.errors.push({msg: 'The confirm password does not match.'});
        }
        if (result.errors.length > 0) {
            console.log(result.errors.map(err => err.msg));
            //req.flash('error', result.errors); //result.errors.map(err => err.msg)
            res.render('pages/register', {title: 'Register', body: req.body, errors: result.errors});
            //res.redirect('/register');
            return; // stop the fn from running
        }
        const user = new User({name: req.body.name, email: req.body.email});
        await user.setPassword(req.body.password);
        await user.save();
        res.redirect('/login');
});

app.get('/newpost', (req, res) => {
    if (req.user) {
        res.render('pages/newpost');
    } else {
        res.redirect('/login');
    }
});

/*app.get('/postsubmit', (req, res) => {
    res.render('pages/postsubmit');
});*/

app.post('/postsubmit', upload.array('images', 5), body('title').trim().escape(), body('description').trim().escape(), async function (req, res, next) {
    if (req.user) {
        // req.files is array of `photos` files
        // req.body will contain the text fields, if there were any
        try {
            req.files.forEach(file=>{
                file['smallPathFilePart'] = smallImagePathPart + file.filename + '.webp';
                file['mediumPathFilePart'] = mediumImagePathPart + file.filename + '.webp';
                file['largePathFilePart'] = largeImagePathPart + file.filename + '.webp';
                file['smallPathFile'] = smallImagePath + file.filename + '.webp';
                file['mediumPathFile'] = mediumImagePath + file.filename + '.webp';
                file['largePathFile'] = largeImagePath + file.filename + '.webp';
            });
            const post = new Post({
                postDate: new Date(),
                title: req.body.title,
                description: req.body.description,
                images: req.files,
                author: 'Mark Foster'
            });
            await post.save();
            await resizeImages(req.files);
            res.render('pages/postpreview');
        } catch(err) {
            console.error('failed');
            console.error(err);
        }
    } else {
        res.redirect('/login');
    }
});

async function resizeImages(images) {
    try {
        images.forEach(async image => {
            await resizeImage(image);
        });
    } catch(err) {
        console.error('failed');
        console.error(err);
    }
}

async function resizeImage(imageObj) {
    try {
        const image = sharp(imageObj.path);
        const imageMetadata = await image.metadata();
        if (imageMetadata.width > smallImageWidth) {
            await sharp(imageObj.path)
                .resize({width: smallImageWidth})
                .toFormat('webp')
                .toFile(imageObj.smallPathFile);
        }
        if (imageMetadata.width > mediumImageWidth) {
            await sharp(imageObj.path)
                .resize({width: mediumImageWidth})
                .toFormat('webp')
                .toFile(imageObj.mediumPathFile);
        }
        if (imageMetadata.width > largeImageWidth) {
            await sharp(imageObj.path)
                .resize({width: largeImageWidth})
                .toFormat('webp')
                .toFile(imageObj.largePathFile);
        }
    } catch(err) {
        console.error('failed');
        console.error(err);
    }
}

app.listen(port, () => {
    console.log(`Nightlight CMS started and listening on port ${port}`);
});