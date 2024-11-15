<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

class CreateEventLinksTable extends Migration
{
    /**
     * Run the migrations.
     *
     * @return void
     */
    public function up()
    {
        Schema::create('event_links', function (Blueprint $table) {
            $table->id(); // Primary key
            $table->foreignId('event_id')->constrained()->onDelete('cascade'); // Foreign key to events
            $table->string('url'); // URL for the event link
            $table->string('link_type')->nullable(); // Type of link (e.g., "booking", "official", etc.)
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
        Schema::dropIfExists('event_links');
    }
}