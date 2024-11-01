<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

class CreateImagesTable extends Migration
{
    /**
     * Run the migrations.
     *
     * @return void
     */
    public function up()
    {
        Schema::create('images', function (Blueprint $table) {
            $table->id(); // Primary key
            $table->foreignId('event_id')->constrained()->onDelete('cascade'); // Foreign key to events
            $table->string('image_url'); // Image URL
            $table->string('alt_text')->nullable(); // Alt text for accessibility
            $table->boolean('is_featured')->default(false); // Indicates if it's the featured image
            $table->timestamps(); // Adds created_at and updated_at columns
        });
    }

    /**
     * Reverse the migrations.
     *
     * @return void
     */
    public function down()
    {
        Schema::dropIfExists('images');
    }
}
